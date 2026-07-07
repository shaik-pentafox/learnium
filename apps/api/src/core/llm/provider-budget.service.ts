import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DomainException } from '../errors/domain.errors';
import { ErrorCode } from '@traineon/contracts';

/**
 * Enforces a provider's optional monthly spend cap. `monthlyBudgetUsd` is
 * captured on the provider; this service is the thing that actually stops calls
 * once month-to-date spend reaches it — checked at model-resolution time (per
 * session / scoring / voice start), not per token.
 */
@Injectable()
export class ProviderBudgetService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throw BUDGET_EXCEEDED if this provider's month-to-date spend has reached its
   *  configured budget. No budget (null / ≤0) → always allowed. */
  async assertWithinBudget(
    providerId: number,
    monthlyBudgetUsd: number | null,
  ): Promise<void> {
    if (monthlyBudgetUsd == null || monthlyBudgetUsd <= 0) return;
    const spent = await this.monthToDateSpend(providerId);
    if (spent >= monthlyBudgetUsd) {
      throw new DomainException(
        ErrorCode.BUDGET_EXCEEDED,
        `Monthly budget of $${monthlyBudgetUsd} reached for this provider ` +
          `(spent $${spent.toFixed(2)} so far). Raise the budget or wait for the next month.`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /** Sum of this provider's LLM spend since the start of the current UTC month.
   *  Usage rows carry `modelId` (no provider FK), so we sum over the provider's
   *  current model ids. */
  async monthToDateSpend(providerId: number): Promise<number> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const models = await this.prisma.llmModel.findMany({
      where: { providerId },
      select: { id: true },
    });
    if (models.length === 0) return 0;
    const agg = await this.prisma.llmUsage.aggregate({
      _sum: { costUsd: true },
      where: {
        modelId: { in: models.map((m) => m.id) },
        createdAt: { gte: monthStart },
      },
    });
    return agg._sum.costUsd ?? 0;
  }
}
