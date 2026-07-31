export type MediaOrientationDegrees = 0 | 90 | 180 | 270;

export interface VideoMediaInfo {
  width: number;
  height: number;
  durationMs: number;
  orientationDegrees: MediaOrientationDegrees;
}

const EXIF_SIGNATURE = Buffer.from([
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
]);

const rotationForExifOrientation = (
  value: number
): MediaOrientationDegrees | null => {
  // Mirrored EXIF orientations retain their quarter-turn component here. The
  // browser decoder normalizes the mirror into derivative pixels, while this
  // value remains sufficient to calculate the source's display dimensions.
  switch (value) {
  case 1:
  case 2:
    return 0;
  case 3:
  case 4:
    return 180;
  case 5:
  case 6:
    return 90;
  case 7:
  case 8:
    return 270;
  default:
    return null;
  }
};

const readExifOrientationSegment = (
  buffer: Buffer,
  payloadStart: number,
  payloadEnd: number
): MediaOrientationDegrees | null => {
  if (payloadEnd - payloadStart < EXIF_SIGNATURE.length + 8 ||
    !buffer.subarray(
      payloadStart,
      payloadStart + EXIF_SIGNATURE.length
    ).equals(EXIF_SIGNATURE)) return null;

  const tiffStart = payloadStart + EXIF_SIGNATURE.length;
  const byteOrder = buffer.subarray(tiffStart, tiffStart + 2).toString("ascii");
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") return null;
  const read16 = (offset: number): number | null => {
    if (offset < tiffStart || offset + 2 > payloadEnd) return null;
    return littleEndian ?
      buffer.readUInt16LE(offset) :
      buffer.readUInt16BE(offset);
  };
  const read32 = (offset: number): number | null => {
    if (offset < tiffStart || offset + 4 > payloadEnd) return null;
    return littleEndian ?
      buffer.readUInt32LE(offset) :
      buffer.readUInt32BE(offset);
  };
  if (read16(tiffStart + 2) !== 42) return null;
  const ifdOffset = read32(tiffStart + 4);
  if (ifdOffset === null || ifdOffset < 8) return null;
  const ifdStart = tiffStart + ifdOffset;
  const entryCount = read16(ifdStart);
  if (entryCount === null) return null;
  const entriesStart = ifdStart + 2;
  const entriesEnd = entriesStart + entryCount * 12;
  if (!Number.isSafeInteger(entriesEnd) || entriesEnd > payloadEnd) return null;

  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = entriesStart + index * 12;
    if (read16(entryStart) !== 0x0112) continue;
    const type = read16(entryStart + 2);
    const count = read32(entryStart + 4);
    if (type !== 3 || count !== 1) return null;
    const value = read16(entryStart + 8);
    return value === null ? null : rotationForExifOrientation(value);
  }
  return null;
};

export const readJpegOrientationDegrees = (
  buffer: Buffer
): MediaOrientationDegrees | null => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x00 || marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }
    const payloadStart = offset + 2;
    const payloadEnd = offset + segmentLength;
    if (marker === 0xe1) {
      const orientation = readExifOrientationSegment(
        buffer,
        payloadStart,
        payloadEnd
      );
      if (orientation !== null) return orientation;
    }
    offset = payloadEnd;
  }
  return null;
};

export const displayDimensionsForOrientation = (
  width: number,
  height: number,
  orientationDegrees: MediaOrientationDegrees
): {width: number; height: number} => (
  orientationDegrees === 90 || orientationDegrees === 270 ?
    {width: height, height: width} :
    {width, height}
);

interface Mp4Box {
  type: string;
  payloadStart: number;
  end: number;
}

const readUInt64 = (buffer: Buffer, offset: number): number | null => {
  if (offset + 8 > buffer.length) return null;
  const high = buffer.readUInt32BE(offset);
  const low = buffer.readUInt32BE(offset + 4);
  const value = high * 0x1_0000_0000 + low;
  return Number.isSafeInteger(value) ? value : null;
};

const listBoxes = (
  buffer: Buffer,
  start: number,
  end: number
): Mp4Box[] => {
  const result: Mp4Box[] = [];
  let offset = start;
  while (offset + 8 <= end && offset + 8 <= buffer.length) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    let headerBytes = 8;
    let size = size32;
    if (size32 === 1) {
      const extended = readUInt64(buffer, offset + 8);
      if (!extended) return result;
      size = extended;
      headerBytes = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerBytes || offset + size > end ||
      offset + size > buffer.length) return result;
    result.push({
      type,
      payloadStart: offset + headerBytes,
      end: offset + size,
    });
    offset += size;
  }
  return result;
};

const movieDurationMs = (
  buffer: Buffer,
  box: Mp4Box
): number | null => {
  const version = buffer[box.payloadStart];
  const timescaleOffset = box.payloadStart + (version === 1 ? 20 : 12);
  const durationOffset = box.payloadStart + (version === 1 ? 24 : 16);
  if (timescaleOffset + 4 > box.end) return null;
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const duration = version === 1 ?
    readUInt64(buffer, durationOffset) :
    durationOffset + 4 <= box.end ?
      buffer.readUInt32BE(durationOffset) :
      null;
  if (!timescale || duration === null) return null;
  const durationMs = Math.round(duration * 1000 / timescale);
  return Number.isSafeInteger(durationMs) && durationMs > 0 ?
    durationMs :
    null;
};

const fixed16 = (buffer: Buffer, offset: number): number => (
  buffer.readInt32BE(offset) / 65536
);

const trackMediaInfo = (
  buffer: Buffer,
  box: Mp4Box
): Omit<VideoMediaInfo, "durationMs"> | null => {
  const version = buffer[box.payloadStart];
  const matrixOffset = box.payloadStart + (version === 1 ? 52 : 40);
  const widthOffset = box.payloadStart + (version === 1 ? 88 : 76);
  const heightOffset = widthOffset + 4;
  if (heightOffset + 4 > box.end || matrixOffset + 20 > box.end) return null;
  const storedWidth = fixed16(buffer, widthOffset);
  const storedHeight = fixed16(buffer, heightOffset);
  if (!Number.isFinite(storedWidth) || !Number.isFinite(storedHeight) ||
    storedWidth <= 0 || storedHeight <= 0) return null;
  const a = fixed16(buffer, matrixOffset);
  const b = fixed16(buffer, matrixOffset + 4);
  const c = fixed16(buffer, matrixOffset + 12);
  const d = fixed16(buffer, matrixOffset + 16);
  const near = (left: number, right: number): boolean => (
    Math.abs(left - right) < 0.01
  );
  let orientationDegrees: 0 | 90 | 180 | 270 = 0;
  if (near(a, 1) && near(b, 0) && near(c, 0) && near(d, 1)) {
    orientationDegrees = 0;
  } else if (near(a, 0) && near(b, 1) &&
    near(c, -1) && near(d, 0)) {
    orientationDegrees = 90;
  } else if (near(a, -1) && near(b, 0) &&
    near(c, 0) && near(d, -1)) {
    orientationDegrees = 180;
  } else if (near(a, 0) && near(b, -1) &&
    near(c, 1) && near(d, 0)) {
    orientationDegrees = 270;
  } else {
    return null;
  }
  const rotated = orientationDegrees === 90 || orientationDegrees === 270;
  return {
    width: Math.round(rotated ? storedHeight : storedWidth),
    height: Math.round(rotated ? storedWidth : storedHeight),
    orientationDegrees,
  };
};

export const readMp4MediaInfo = (buffer: Buffer): VideoMediaInfo | null => {
  const root = listBoxes(buffer, 0, buffer.length);
  if (!root.some(({type}) => type === "ftyp")) return null;
  const moov = root.find(({type}) => type === "moov");
  if (!moov) return null;
  const movieBoxes = listBoxes(buffer, moov.payloadStart, moov.end);
  const mvhd = movieBoxes.find(({type}) => type === "mvhd");
  const durationMs = mvhd ? movieDurationMs(buffer, mvhd) : null;
  if (!durationMs) return null;
  for (const trak of movieBoxes.filter(({type}) => type === "trak")) {
    const tkhd = listBoxes(buffer, trak.payloadStart, trak.end)
      .find(({type}) => type === "tkhd");
    if (!tkhd) continue;
    const track = trackMediaInfo(buffer, tkhd);
    if (track) return {...track, durationMs};
  }
  return null;
};
