const test = require("node:test");
const assert = require("node:assert/strict");

const {
  displayDimensionsForOrientation,
  readJpegOrientationDegrees,
  readMp4MediaInfo,
} = require("../lib/mediaProbe");

const box = (type, payload) => {
  const result = Buffer.alloc(payload.length + 8);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, "ascii");
  payload.copy(result, 8);
  return result;
};

const fixed16 = (value) => Math.round(value * 65536);

const mp4Fixture = ({
  width = 1920,
  height = 1080,
  durationMs = 12_500,
  orientation = 0,
  matrixOverride = null,
} = {}) => {
  const ftyp = box("ftyp", Buffer.from("isom\u0000\u0000\u0000\u0000isom", "binary"));
  const mvhdPayload = Buffer.alloc(20);
  mvhdPayload.writeUInt32BE(1000, 12);
  mvhdPayload.writeUInt32BE(durationMs, 16);
  const tkhdPayload = Buffer.alloc(84);
  const matrix = matrixOverride || {
    0: [1, 0, 0, 1],
    90: [0, 1, -1, 0],
    180: [-1, 0, 0, -1],
    270: [0, -1, 1, 0],
  }[orientation];
  tkhdPayload.writeInt32BE(fixed16(matrix[0]), 40);
  tkhdPayload.writeInt32BE(fixed16(matrix[1]), 44);
  tkhdPayload.writeInt32BE(fixed16(matrix[2]), 52);
  tkhdPayload.writeInt32BE(fixed16(matrix[3]), 56);
  tkhdPayload.writeInt32BE(0x40000000, 72);
  tkhdPayload.writeInt32BE(fixed16(width), 76);
  tkhdPayload.writeInt32BE(fixed16(height), 80);
  return Buffer.concat([
    ftyp,
    box("moov", Buffer.concat([
      box("mvhd", mvhdPayload),
      box("trak", box("tkhd", tkhdPayload)),
    ])),
  ]);
};

const jpegExifFixture = ({
  littleEndian = true,
  orientation = 1,
} = {}) => {
  const tiff = Buffer.alloc(26);
  tiff.write(littleEndian ? "II" : "MM", 0, "ascii");
  const write16 = littleEndian ?
    tiff.writeUInt16LE.bind(tiff) :
    tiff.writeUInt16BE.bind(tiff);
  const write32 = littleEndian ?
    tiff.writeUInt32LE.bind(tiff) :
    tiff.writeUInt32BE.bind(tiff);
  write16(42, 2);
  write32(8, 4);
  write16(1, 8);
  write16(0x0112, 10);
  write16(3, 12);
  write32(1, 14);
  write16(orientation, 18);
  write32(0, 22);
  const payload = Buffer.concat([
    Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]),
    tiff,
  ]);
  const app1 = Buffer.alloc(payload.length + 4);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    Buffer.from([0xff, 0xd9]),
  ]);
};

test("JPEG EXIF probe reads little-endian rotations and display dimensions", () => {
  assert.equal(readJpegOrientationDegrees(jpegExifFixture({
    littleEndian: true,
    orientation: 6,
  })), 90);
  assert.equal(readJpegOrientationDegrees(jpegExifFixture({
    littleEndian: true,
    orientation: 3,
  })), 180);
  assert.deepEqual(displayDimensionsForOrientation(1600, 900, 90), {
    width: 900,
    height: 1600,
  });
});

test("JPEG EXIF probe reads big-endian rotations", () => {
  assert.equal(readJpegOrientationDegrees(jpegExifFixture({
    littleEndian: false,
    orientation: 8,
  })), 270);
  assert.equal(readJpegOrientationDegrees(jpegExifFixture({
    littleEndian: false,
    orientation: 1,
  })), 0);
});

test("JPEG EXIF probe safely ignores malformed APP1/TIFF payloads", () => {
  const invalidOffset = jpegExifFixture({orientation: 6});
  invalidOffset.writeUInt32LE(0xffffffff, 16);
  assert.equal(readJpegOrientationDegrees(invalidOffset), null);
  assert.equal(readJpegOrientationDegrees(Buffer.from([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x45, 0x78, 0x69, 0x66,
  ])), null);
});

test("MP4 probe reads authoritative duration and landscape dimensions", () => {
  assert.deepEqual(readMp4MediaInfo(mp4Fixture()), {
    width: 1920,
    height: 1080,
    durationMs: 12_500,
    orientationDegrees: 0,
  });
});

test("MP4 probe applies track rotation to display dimensions", () => {
  assert.deepEqual(readMp4MediaInfo(mp4Fixture({
    width: 1920,
    height: 1080,
    orientation: 90,
  })), {
    width: 1080,
    height: 1920,
    durationMs: 12_500,
    orientationDegrees: 90,
  });
});

test("MP4 probe recognizes all canonical quarter-turn matrices", () => {
  assert.equal(readMp4MediaInfo(mp4Fixture({
    orientation: 180,
  })).orientationDegrees, 180);
  assert.deepEqual(readMp4MediaInfo(mp4Fixture({
    orientation: 270,
  })), {
    width: 1080,
    height: 1920,
    durationMs: 12_500,
    orientationDegrees: 270,
  });
});

test("MP4 probe rejects unsupported or mirrored track transforms", () => {
  assert.equal(readMp4MediaInfo(mp4Fixture({
    matrixOverride: [0.7071, 0.7071, -0.7071, 0.7071],
  })), null);
  assert.equal(readMp4MediaInfo(mp4Fixture({
    matrixOverride: [-1, 0, 0, 1],
  })), null);
});

test("MP4 probe rejects corrupt and incomplete containers", () => {
  assert.equal(readMp4MediaInfo(Buffer.from("not-mp4")), null);
  assert.equal(readMp4MediaInfo(box(
    "ftyp",
    Buffer.from("isom\u0000\u0000\u0000\u0000isom", "binary")
  )), null);
});
