import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { sixelEncode, introducer, FINALIZER } from 'sixel';
import Audic from 'audic';
import { performance } from 'perf_hooks';

const FRAMES_DIR = path.resolve(__dirname, '../frames');
const FRAME_PREFIX = 'output_';
const FRAME_SUFFIX = '.png';
const FPS = 30;
const INTERVAL_MS = 1000 / FPS;
const START_FRAME = 1;
const END_FRAME = 6570;
const PREFETCH_FRAMES = FPS * 3;
const INITIAL_BUFFER_FRAMES = FPS;
const FRAME_LAG_TOLERANCE_FRAMES = 0.5;
const MAX_CATCHUP_FRAMES = 2;
const framePromises = new Map<number, Promise<string>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const formatFrameNumber = (frame: number) => `${frame}`.padStart(4, '0');

async function loadFrame(frameNumber: number) {
  const framePath = path.join(
    FRAMES_DIR,
    `${FRAME_PREFIX}${formatFrameNumber(frameNumber)}${FRAME_SUFFIX}`,
  );
  const buffer = await fs.readFile(framePath);
  const image = sharp(buffer);
  const raw = await image
    .ensureAlpha()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const payload = sixelEncode(raw.data, raw.info.width, raw.info.height, [
      [0, 0, 0],
      [255, 255, 255],
  ]);
  return `${introducer(1)}${payload}${FINALIZER}`;
}

function scheduleFrame(frameNumber: number) {
  if (frameNumber > END_FRAME || framePromises.has(frameNumber)) {
    return;
  }

  framePromises.set(frameNumber, loadFrame(frameNumber));
}

function ensureWindow(anchorFrame: number) {
  const start = Math.max(anchorFrame, START_FRAME);
  const maxFrame = Math.min(END_FRAME, start + PREFETCH_FRAMES);

  for (let frame = start; frame <= maxFrame; frame += 1) {
    scheduleFrame(frame);
  }
}

async function warmUpInitialFrames() {
  ensureWindow(START_FRAME);
  const warmupEnd = Math.min(END_FRAME, START_FRAME + INITIAL_BUFFER_FRAMES - 1);
  const warmupPromises: Promise<string>[] = [];

  for (let frame = START_FRAME; frame <= warmupEnd; frame += 1) {
    const framePromise = framePromises.get(frame);
    if (!framePromise) {
      throw new Error(`Frame ${frame} was not scheduled for warmup.`);
    }
    warmupPromises.push(framePromise);
  }

  await Promise.all(warmupPromises);
}

async function consumeFrame(frameNumber: number) {
  if (!framePromises.has(frameNumber)) {
    scheduleFrame(frameNumber);
  }

  const promise = framePromises.get(frameNumber);
  if (!promise) {
    throw new Error(`Frame ${frameNumber} could not be loaded.`);
  }

  try {
    return await promise;
  } finally {
    framePromises.delete(frameNumber);
  }
}

async function main() {
  await warmUpInitialFrames();

  const audic = new Audic('bgm.aac');
  audic.addEventListener('ended', () => {
      audic.destroy();
  });

  audic.addEventListener('playing', async () => {
    process.stdout.write('\u001b[?25l');
    let nextFrameTimestamp: number | null = null;
    const startTime = performance.now();

    for (let frame = START_FRAME; frame <= END_FRAME; frame += 1) {
        ensureWindow(frame);
        const sixelData = await consumeFrame(frame);
        const beforeRender = performance.now();

        if (nextFrameTimestamp !== null) {
            const lead = nextFrameTimestamp - beforeRender;
            if (lead > 0) {
                await sleep(lead);
            } else {
                nextFrameTimestamp = beforeRender;
            }
        }

        process.stdout.write('\u001b[H');
        process.stdout.write(sixelData);

        const elapsedMs = performance.now() - startTime;
        const renderedFrames = frame - START_FRAME + 1;
        const expectedFrames = elapsedMs / INTERVAL_MS;
        const frameLag = expectedFrames - renderedFrames;
        let catchUpMs = 0;

        if (frameLag > FRAME_LAG_TOLERANCE_FRAMES) {
            const lagBeyondTolerance = Math.min(
                frameLag - FRAME_LAG_TOLERANCE_FRAMES,
                MAX_CATCHUP_FRAMES,
            );
            catchUpMs = lagBeyondTolerance * INTERVAL_MS;
        }

        const baseTimestamp = startTime + frame * INTERVAL_MS;
        nextFrameTimestamp = baseTimestamp - catchUpMs;
    }

    process.stdout.write('\u001b[?25h');
  });
  await audic.play();
}

main().catch((error) => {
  process.stdout.write('\u001b[?25h');
  console.error(error);
  process.exit(1);
});
