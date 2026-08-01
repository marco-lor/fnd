const test = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const {mkdtemp, readFile, rm} = require("node:fs/promises");
const {tmpdir} = require("node:os");
const {join} = require("node:path");

const sharp = require("sharp");
const ffmpeg = require("ffmpeg-static");
const {
  createTask07DefaultMediaTransformer,
} = require("../lib/mediaProcessorRuntime");

sharp.concurrency(1);
sharp.cache(false);

test("pinned sharp and ffmpeg stack creates image and video derivatives", {
  timeout: 30_000,
}, async () => {
  const transformer = createTask07DefaultMediaTransformer();
  const image = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: {r: 30, g: 80, b: 140, alpha: 1},
    },
  }).png().toBuffer();
  const imageSource = await transformer.inspectSource({
    buffer: image,
    kind: "avatar",
    declaredContentType: "image/png",
    maxInputPixels: 16_000_000,
  });
  assert.equal(imageSource.width, 120);
  assert.equal(imageSource.height, 80);
  const thumbnail = await transformer.createVariant({
    buffer: image,
    kind: "avatar",
    source: imageSource,
    variant: "thumbnail",
    maxInputPixels: 16_000_000,
  });
  assert.deepEqual(
    {width: thumbnail.width, height: thumbnail.height},
    {width: 64, height: 64}
  );
  assert.equal(thumbnail.buffer.subarray(0, 4).toString("ascii"), "RIFF");

  const directory = await mkdtemp(join(tmpdir(), "task07-native-spike-"));
  try {
    const videoPath = join(directory, "source.mp4");
    const generated = spawnSync(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=1",
      "-t", "2", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-threads", "1", "-y", videoPath,
    ], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    });
    assert.equal(generated.status, 0, generated.stderr || generated.error?.message);
    const video = await readFile(videoPath);
    const videoSource = await transformer.inspectSource({
      buffer: video,
      kind: "map-video",
      declaredContentType: "video/mp4",
      maxInputPixels: 2_073_600,
    });
    assert.equal(videoSource.width, 320);
    assert.equal(videoSource.height, 180);
    assert.ok(videoSource.durationMs >= 1_000 && videoSource.durationMs <= 3_000);
    const poster = await transformer.createVariant({
      buffer: video,
      kind: "map-video",
      source: videoSource,
      variant: "poster",
      maxInputPixels: 2_073_600,
    });
    assert.deepEqual(
      {width: poster.width, height: poster.height},
      {width: 320, height: 180}
    );
    assert.equal(poster.buffer.subarray(0, 4).toString("ascii"), "RIFF");
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
