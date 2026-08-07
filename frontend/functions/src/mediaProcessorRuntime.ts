import {spawn} from "child_process";
import {mkdtemp, readFile, rm, writeFile} from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {
  MEDIA_CONTRACTS,
  MediaKind,
  MediaVariantName,
  normalizeMediaContentType,
  plannedMediaVariantDimensions,
} from "./mediaContracts";
import {
  Task07DecodedSource,
  Task07MediaTransformer,
  Task07ProcessorError,
  Task07VariantOutput,
} from "./mediaAssetProcessorCore";

type SharpMetadata = {
  format?: string;
  width?: number;
  height?: number;
  pages?: number;
  orientation?: number;
};

type SharpOutputInfo = {
  width: number;
  height: number;
};

type SharpPipeline = {
  metadata(): Promise<SharpMetadata>;
  rotate(): SharpPipeline;
  resize(options: {
    width: number;
    height: number;
    fit: "cover" | "inside";
    withoutEnlargement: boolean;
    position?: string;
  }): SharpPipeline;
  webp(options: {
    quality: number;
    effort: number;
    smartSubsample: boolean;
  }): SharpPipeline;
  toBuffer(options: {resolveWithObject: true}):
    Promise<{data: Buffer; info: SharpOutputInfo}>;
};

type SharpFactory = {
  (input: Buffer, options?: {
    failOn: "warning";
    limitInputPixels: number;
    pages?: number;
    sequentialRead: boolean;
  }): SharpPipeline;
  cache(options: {files: number; items: number; memory: number}): void;
  concurrency(value: number): void;
};

type FfprobeDocument = {
  format?: {
    duration?: string;
    format_name?: string;
  };
  streams?: Array<{
    codec_name?: string;
    codec_type?: "video" | "audio";
    duration?: string;
    height?: number;
    side_data_list?: Array<{rotation?: number}>;
    tags?: {rotate?: string};
    width?: number;
  }>;
};

const TASK07_BINARY_TIMEOUT_MS = 30_000;

export const task07VideoPosterTimestamp = (durationMs: unknown): string => {
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Task07ProcessorError("source-duration-invalid");
  }
  return (Math.min(1_000, Math.floor(duration / 2)) / 1_000).toFixed(3);
};

const sharpFactory = (): SharpFactory => {
  try {
    const loaded = require("sharp") as SharpFactory;
    loaded.concurrency(1);
    loaded.cache({memory: 32, files: 0, items: 16});
    return loaded;
  } catch {
    throw new Task07ProcessorError(
      "processor-sharp-dependency-unavailable",
      true
    );
  }
};

const binaryPath = (
  packageName: "ffmpeg-static" | "ffprobe-static"
): string => {
  try {
    const loaded = require(packageName) as string | {path?: unknown};
    const path = typeof loaded === "string" ?
      loaded :
      typeof loaded.path === "string" ? loaded.path : "";
    if (!path) throw new Error("missing-path");
    return path;
  } catch {
    throw new Task07ProcessorError(
      `processor-${packageName}-dependency-unavailable`,
      true
    );
  }
};

const runBinary = (
  executable: string,
  args: string[],
  maxOutputBytes = 1024 * 1024,
  timeoutMs = TASK07_BINARY_TIMEOUT_MS
): Promise<{stdout: Buffer; stderr: Buffer}> => new Promise(
  (resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const rejectOnce = (error: Task07ProcessorError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => {
      child.kill();
      rejectOnce(new Task07ProcessorError(
        "processor-binary-timeout",
        true
      ));
    }, timeoutMs);
    const collect = (target: Buffer[], chunk: Buffer): void => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        rejectOnce(new Task07ProcessorError(
          "processor-binary-output-overflow"
        ));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", () => rejectOnce(
      new Task07ProcessorError("processor-binary-start-failed", true)
    ));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (code === 0) {
        resolve(result);
      } else {
        reject(new Task07ProcessorError("processor-binary-failed"));
      }
    });
  }
);

const withInputFile = async <Result>(
  buffer: Buffer,
  extension: string,
  worker: (directory: string, sourcePath: string) => Promise<Result>
): Promise<Result> => {
  const directory = await mkdtemp(join(tmpdir(), "task07-media-"));
  try {
    const sourcePath = join(directory, `source.${extension}`);
    await writeFile(sourcePath, buffer, {flag: "wx"});
    return await worker(directory, sourcePath);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
};

const formatMime = (format: string | undefined): string => {
  switch (format) {
  case "jpeg": return "image/jpeg";
  case "png": return "image/png";
  case "webp": return "image/webp";
  default: return "";
  }
};

const orientationDegrees = (
  orientation: number | undefined
): 0 | 90 | 180 | 270 => {
  switch (orientation) {
  case 3: return 180;
  case 6: return 90;
  case 8: return 270;
  default: return 0;
  }
};

const normalizedRotation = (
  value: unknown
): 0 | 90 | 180 | 270 => {
  const numeric = Number(value);
  const normalized = ((numeric % 360) + 360) % 360;
  return [0, 90, 180, 270].includes(normalized) ?
    normalized as 0 | 90 | 180 | 270 :
    0;
};

const extensionFor = (contentType: string): string => {
  switch (contentType) {
  case "video/mp4":
  case "audio/mp4": return "mp4";
  case "video/webm": return "webm";
  case "audio/mpeg": return "mp3";
  case "audio/aac": return "aac";
  case "audio/ogg": return "ogg";
  case "audio/wav":
  case "audio/x-wav": return "wav";
  default: return "bin";
  }
};

const allowedCodec = (
  contentType: string,
  codec: string
): boolean => {
  const codecs: Record<string, readonly string[]> = {
    "video/mp4": ["h264", "av1"],
    "video/webm": ["vp8", "vp9", "av1"],
    "audio/mpeg": ["mp3"],
    "audio/mp4": ["aac"],
    "audio/aac": ["aac"],
    "audio/ogg": ["vorbis", "opus"],
    "audio/wav": [
      "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8",
    ],
    "audio/x-wav": [
      "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8",
    ],
  };
  return Boolean(codecs[contentType]?.includes(codec));
};

const formatMatches = (
  contentType: string,
  formatName: string
): boolean => {
  const formats = new Set(formatName.split(","));
  switch (contentType) {
  case "video/mp4":
  case "audio/mp4":
    return formats.has("mov") || formats.has("mp4");
  case "video/webm": return formats.has("matroska") || formats.has("webm");
  case "audio/mpeg": return formats.has("mp3");
  case "audio/aac": return formats.has("aac");
  case "audio/ogg": return formats.has("ogg");
  case "audio/wav":
  case "audio/x-wav": return formats.has("wav");
  default: return false;
  }
};

const probeAvSource = async (
  buffer: Buffer,
  contentType: string
): Promise<Task07DecodedSource> => withInputFile(
  buffer,
  extensionFor(contentType),
  async (_directory, sourcePath) => {
    const result = await runBinary(binaryPath("ffprobe-static"), [
      "-v", "error",
      "-show_entries",
      "format=format_name,duration:" +
        "stream=codec_type,codec_name,width,height,duration:stream_tags=rotate:" +
        "stream_side_data_list=rotation",
      "-of", "json",
      sourcePath,
    ]);
    let probe: FfprobeDocument;
    try {
      probe = JSON.parse(result.stdout.toString("utf8")) as FfprobeDocument;
    } catch {
      throw new Task07ProcessorError("source-probe-invalid");
    }
    const expectedStreamType = contentType.startsWith("video/") ?
      "video" :
      "audio";
    const stream = probe.streams?.find(
      ({codec_type: type}) => type === expectedStreamType
    );
    const codec = stream?.codec_name || "";
    const formatName = probe.format?.format_name || "";
    if (!stream || !allowedCodec(contentType, codec) ||
      !formatMatches(contentType, formatName)) {
      throw new Task07ProcessorError("source-codec-unsupported");
    }
    const durationSeconds = Number(
      stream.duration || probe.format?.duration
    );
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Task07ProcessorError("source-duration-invalid");
    }
    const rotation = normalizedRotation(
      stream.side_data_list?.find(({rotation}) => rotation !== undefined)
        ?.rotation ?? stream.tags?.rotate
    );
    const rawWidth = Number(stream.width || 0);
    const rawHeight = Number(stream.height || 0);
    const swap = rotation === 90 || rotation === 270;
    return {
      contentType,
      width: expectedStreamType === "video" ?
        (swap ? rawHeight : rawWidth) :
        0,
      height: expectedStreamType === "video" ?
        (swap ? rawWidth : rawHeight) :
        0,
      durationMs: Math.round(durationSeconds * 1000),
      orientationDegrees: rotation,
      codec,
    };
  }
);

const imageMetadata = async (
  buffer: Buffer,
  kind: MediaKind,
  contentType: string,
  maxInputPixels: number
): Promise<Task07DecodedSource> => {
  void kind;
  const sharp = sharpFactory();
  let metadata: SharpMetadata;
  try {
    metadata = await sharp(buffer, {
      failOn: "warning",
      limitInputPixels: maxInputPixels,
      pages: 2,
      sequentialRead: true,
    }).metadata();
  } catch {
    throw new Task07ProcessorError("source-image-decode-failed");
  }
  const actualContentType = formatMime(metadata.format);
  if (!actualContentType ||
    actualContentType !== normalizeMediaContentType(contentType) ||
    Number(metadata.pages || 1) !== 1) {
    throw new Task07ProcessorError("source-image-format-unsupported");
  }
  const rotation = orientationDegrees(metadata.orientation);
  const rawWidth = Number(metadata.width || 0);
  const rawHeight = Number(metadata.height || 0);
  const swap = rotation === 90 || rotation === 270;
  return {
    contentType: actualContentType,
    width: swap ? rawHeight : rawWidth,
    height: swap ? rawWidth : rawHeight,
    durationMs: null,
    orientationDegrees: rotation,
    codec: null,
  };
};

const webpVariant = async (input: {
  buffer: Buffer;
  kind: MediaKind;
  source: Task07DecodedSource;
  variant: MediaVariantName;
  maxInputPixels: number;
}): Promise<Task07VariantOutput> => {
  const contract = MEDIA_CONTRACTS[input.kind].variants[input.variant];
  if (!contract) throw new Task07ProcessorError("processor-contract-invalid");
  const expected = plannedMediaVariantDimensions(input.source, contract);
  if (!expected) throw new Task07ProcessorError("source-dimensions-invalid");
  const sharp = sharpFactory();
  const result = await sharp(input.buffer, {
    failOn: "warning",
    limitInputPixels: input.maxInputPixels,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      width: contract.width,
      height: contract.height,
      fit: contract.fit,
      withoutEnlargement: true,
      position: contract.fit === "cover" ? "centre" : undefined,
    })
    .webp({
      quality: contract.quality,
      effort: 4,
      smartSubsample: true,
    })
    .toBuffer({resolveWithObject: true});
  if (result.info.width !== expected.width ||
    result.info.height !== expected.height) {
    throw new Task07ProcessorError("variant-dimension-mismatch");
  }
  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
  };
};

const videoPoster = async (input: {
  buffer: Buffer;
  kind: MediaKind;
  source: Task07DecodedSource;
  variant: MediaVariantName;
  maxInputPixels: number;
}): Promise<Task07VariantOutput> => {
  const contentType = input.source.contentType;
  return withInputFile(
    input.buffer,
    extensionFor(contentType),
    async (directory, sourcePath) => {
      const posterPath = join(directory, "poster.png");
      await runBinary(binaryPath("ffmpeg-static"), [
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-filter_threads", "1",
        "-ss", task07VideoPosterTimestamp(input.source.durationMs),
        "-i", sourcePath,
        "-frames:v", "1",
        "-vf", "scale=in_range=full:out_range=full",
        "-threads", "1",
        "-f", "image2",
        posterPath,
      ]);
      const poster = await readFile(posterPath);
      return webpVariant({...input, buffer: poster});
    }
  );
};

export const createTask07DefaultMediaTransformer =
  (): Task07MediaTransformer => ({
    inspectSource: async ({
      buffer, kind, declaredContentType, maxInputPixels,
    }) => {
      const mediaType = MEDIA_CONTRACTS[kind].source.mediaType;
      return mediaType === "image" ?
        imageMetadata(buffer, kind, declaredContentType, maxInputPixels) :
        probeAvSource(buffer, declaredContentType);
    },
    createVariant: async (input) => (
      MEDIA_CONTRACTS[input.kind].source.mediaType === "video" ?
        videoPoster(input) :
        webpVariant(input)
    ),
  });
