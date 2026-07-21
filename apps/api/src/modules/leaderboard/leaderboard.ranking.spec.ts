import { describe, it, expect } from '@jest/globals';
import { rankTrainees, sessionScorePct, type TraineeInput } from './leaderboard.ranking';

/** Session that scored `earned` out of `max` on a single criterion. */
const session = (earned: number | null, max = 10) => ({
  scores: [{ score: earned, maxScore: max }],
});

const trainee = (
  userId: number,
  name: string,
  sessions: TraineeInput['sessions'],
): TraineeInput => ({ userId, name, avatarUrl: null, sessions });

describe('sessionScorePct', () => {
  it('pools criteria into a single percentage', () => {
    const pct = sessionScorePct([
      { score: 8, maxScore: 10 },
      { score: 6, maxScore: 10 },
    ]);
    expect(pct).toBe(70);
  });

  it('ignores unscored criteria', () => {
    const pct = sessionScorePct([
      { score: 9, maxScore: 10 },
      { score: null, maxScore: 10 },
    ]);
    expect(pct).toBe(90);
  });

  it('returns null when nothing was scored', () => {
    expect(sessionScorePct([{ score: null, maxScore: 10 }])).toBeNull();
    expect(sessionScorePct([])).toBeNull();
  });
});

describe('rankTrainees', () => {
  it('ranks by points, so volume and quality both count', () => {
    // Arrange: Bo scores higher per session, Ana practises more.
    const ana = trainee(1, 'Ana', [session(8), session(8), session(8)]); // 240
    const bo = trainee(2, 'Bo', [session(10), session(10)]); // 200

    // Act
    const rows = rankTrainees([bo, ana]);

    // Assert
    expect(rows.map((r) => r.name)).toEqual(['Ana', 'Bo']);
    expect(rows[0]!.points).toBe(240);
    expect(rows[0]!.avgScorePct).toBe(80);
    expect(rows[1]!.points).toBe(200);
    expect(rows[1]!.avgScorePct).toBe(100);
  });

  it('assigns equal ranks to equal points and skips the next rank', () => {
    const rows = rankTrainees([
      trainee(1, 'Ana', [session(10), session(10)]), // 200
      trainee(2, 'Bo', [session(10), session(10)]), // 200
      trainee(3, 'Cy', [session(5)]), // 50
    ]);

    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('breaks point ties on average score before session count', () => {
    // Both total 100 points: Bo from one perfect session, Ana from two halves.
    const rows = rankTrainees([
      trainee(1, 'Ana', [session(5), session(5)]),
      trainee(2, 'Bo', [session(10)]),
    ]);

    expect(rows[0]!.name).toBe('Bo');
    expect(rows[0]!.avgScorePct).toBe(100);
  });

  it('counts unscored sessions in the total but not toward points', () => {
    const rows = rankTrainees([trainee(1, 'Ana', [session(8), session(null)])]);

    expect(rows[0]!.sessions).toBe(2);
    expect(rows[0]!.scoredSessions).toBe(1);
    expect(rows[0]!.points).toBe(80);
    expect(rows[0]!.avgScorePct).toBe(80);
  });

  it('places a trainee with no scored sessions last with null average', () => {
    const rows = rankTrainees([
      trainee(1, 'Ana', [session(null)]),
      trainee(2, 'Bo', [session(1)]),
    ]);

    expect(rows.map((r) => r.name)).toEqual(['Bo', 'Ana']);
    expect(rows[1]!.points).toBe(0);
    expect(rows[1]!.avgScorePct).toBeNull();
  });

  it('returns an empty board for no trainees', () => {
    expect(rankTrainees([])).toEqual([]);
  });
});
