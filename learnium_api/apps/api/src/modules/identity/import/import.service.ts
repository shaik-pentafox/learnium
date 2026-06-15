import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';
import { PrismaService } from '../../../core/database/prisma.service';
import { NotFoundException } from '../../../core/errors/domain.errors';

export const USER_IMPORT_QUEUE = 'user-import';

export interface ImportRow {
  rowNum: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  supervisorEmployeeId?: string;
  username?: string;
  password?: string;
}

export interface ImportError {
  rowNum: number;
  employeeId: string;
  field: string;
  message: string;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(USER_IMPORT_QUEUE) private readonly queue: Queue,
  ) {}

  async startImport(buffer: Buffer, filename: string, initiatorId: number) {
    const rows = await this.parseBuffer(buffer, filename);

    const report = await this.prisma.importReport.create({
      data: { userId: initiatorId, status: 'PENDING', totalRows: rows.length },
    });

    await this.queue.add('process', { reportId: report.id, rows, initiatorId });

    return { reportId: report.id, totalRows: rows.length };
  }

  async getReport(reportId: string) {
    const report = await this.prisma.importReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('ImportReport', reportId);
    return report;
  }

  async streamErrors(reportId: string, reply: FastifyReply) {
    const report = await this.prisma.importReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('ImportReport', reportId);

    const errors = (report.errorData as ImportError[] | null) ?? [];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Errors');
    ws.columns = [
      { header: 'Row', key: 'rowNum', width: 8 },
      { header: 'Employee ID', key: 'employeeId', width: 20 },
      { header: 'Field', key: 'field', width: 20 },
      { header: 'Error', key: 'message', width: 50 },
    ];
    for (const err of errors) ws.addRow(err);

    const buf = await wb.xlsx.writeBuffer();
    void reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="import-errors-${reportId}.xlsx"`)
      .send(buf);
  }

  private async parseBuffer(buffer: Buffer, filename: string): Promise<ImportRow[]> {
    const wb = new ExcelJS.Workbook();
    if (filename.toLowerCase().endsWith('.csv')) {
      await wb.csv.read(Readable.from(buffer));
    } else {
      await wb.xlsx.read(Readable.from(buffer));
    }

    const ws = wb.worksheets[0];
    if (!ws) return [];

    const rows: ImportRow[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const vals = row.values as (string | undefined)[];
      const get = (i: number): string => (vals[i] ? String(vals[i]).trim() : '');
      const supId = get(6);
      const uname = get(7);
      const pass = get(8);
      rows.push({
        rowNum,
        employeeId: get(1),
        firstName: get(2),
        lastName: get(3),
        email: get(4),
        role: get(5),
        ...(supId ? { supervisorEmployeeId: supId } : {}),
        ...(uname ? { username: uname } : {}),
        ...(pass ? { password: pass } : {}),
      });
    });

    return rows;
  }
}
