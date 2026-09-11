import { describe, expect, it } from 'vitest';
import { createGuidanceTool, MAX_STEPS } from '../src/agent/guidance.js';
import type { Bounds, Point } from '../src/shared/geometry.js';

const DISPLAY: Bounds = { x: 0, y: 0, width: 1440, height: 900 };

function stand(display: Bounds = DISPLAY, cursor: Point = { x: 0, y: 0 }) {
  const runs: Array<Array<{ text: string; point: Point }>> = [];
  const tool = createGuidanceTool({
    displayAt: () => display,
    cursor: () => cursor,
    guide: async (steps) => {
      runs.push([...steps]);
      return { shown: steps.length };
    },
  });
  return { tool, runs };
}

const stepsArg = (steps: Array<{ text: string; x: number; y: number }>): string => JSON.stringify(steps);

describe('guide_through', () => {
  it('turns a JSON sequence into screen points on the grid point_to uses', async () => {
    const s = stand();
    const result = await s.tool.run({
      steps: stepsArg([
        { text: 'Open Settings', x: 500, y: 50 },
        { text: 'Click Advanced', x: 300, y: 400 },
      ]),
    });

    expect(s.runs).toEqual([
      [
        { text: 'Open Settings', point: { x: 720, y: 45 } },
        { text: 'Click Advanced', point: { x: 432, y: 360 } },
      ],
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.content).toBe('Walked through 2 steps.');
  });

  it('reports the count it actually walked through, not just the count it was sent', async () => {
    const s = stand();
    s.tool = createGuidanceTool({
      displayAt: () => DISPLAY,
      cursor: () => ({ x: 0, y: 0 }),
      guide: async () => ({ shown: 1 }),
    });
    const result = await s.tool.run({ steps: stepsArg([{ text: 'One', x: 0, y: 0 }]) });
    expect(result.content).toBe('Walked through 1 step.');
  });

  it('refuses text that is not a JSON array, rather than flying anywhere', async () => {
    const s = stand();
    const result = await s.tool.run({ steps: 'walk me through it' });
    expect(result.isError).toBe(true);
    expect(s.runs).toHaveLength(0);
  });

  it('refuses an empty sequence', async () => {
    const s = stand();
    const result = await s.tool.run({ steps: stepsArg([]) });
    expect(result.isError).toBe(true);
    expect(s.runs).toHaveLength(0);
  });

  it('refuses a step missing text or coordinates rather than guessing', async () => {
    const s = stand();
    const result = await s.tool.run({ steps: JSON.stringify([{ text: 'Open Settings', x: 500 }]) });
    expect(result.isError).toBe(true);
    expect(s.runs).toHaveLength(0);
  });

  it('refuses a step whose text is empty', async () => {
    const s = stand();
    const result = await s.tool.run({ steps: stepsArg([{ text: '  ', x: 0, y: 0 }]) });
    expect(result.isError).toBe(true);
    expect(s.runs).toHaveLength(0);
  });

  it('truncates a sequence longer than the cap and says so', async () => {
    const s = stand();
    const many = Array.from({ length: MAX_STEPS + 5 }, (_, i) => ({ text: `Step ${i}`, x: 0, y: 0 }));
    const result = await s.tool.run({ steps: stepsArg(many) });

    expect(s.runs[0]).toHaveLength(MAX_STEPS);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('cut short');
    expect(result.content).toContain(`${many.length} steps`);
  });

  it('does not mention truncation when the sequence is within the cap', async () => {
    const s = stand();
    const result = await s.tool.run({ steps: stepsArg([{ text: 'One', x: 0, y: 0 }]) });
    expect(result.content).not.toContain('cut short');
  });

  it('points on the display the question was about, not a fixed one', async () => {
    const second: Bounds = { x: 1440, y: 0, width: 1920, height: 1080 };
    const s = stand(second, { x: 1500, y: 100 });
    await s.tool.run({ steps: stepsArg([{ text: 'Open Settings', x: 250, y: 500 }]) });
    expect(s.runs[0]).toEqual([{ text: 'Open Settings', point: { x: 1920, y: 540 } }]);
  });
});
