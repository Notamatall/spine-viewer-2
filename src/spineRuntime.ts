import type { Container, TextureSource } from "pixi.js";

export type SpineRuntimeVersion = "4.2" | "4.3";

export interface AnimationLike {
  name: string;
}

export interface SkinLike {
  name: string;
}

export interface SkeletonDataLike {
  animations: AnimationLike[];
  skins: SkinLike[];
}

// The shape of Slot/Skeleton's pose-related API differs between the 4.2 and
// 4.3 runtimes (4.3 introduced `pose`/`appliedPose` wrappers and renamed
// several methods). SlotLike/SkeletonLike expose only what's identical across
// both; version-specific access goes through the helpers below.
export interface SlotLike {
  [key: string]: unknown;
}

export interface SkeletonLike {
  data: SkeletonDataLike;
  findSlot(name: string): SlotLike | null;
  [key: string]: unknown;
}

interface Skeleton42Like {
  setSkinByName(name: string): void;
  setToSetupPose(): void;
  setSlotsToSetupPose(): void;
}

interface Skeleton43Like {
  setSkin(name: string): void;
  setupPose(): void;
  setupPoseSlots(): void;
}

interface Slot42Like {
  getAttachment(): object | null;
}

interface Slot43Like {
  pose: { attachment: object | null };
}

export const setSkeletonSkin = (
  version: SpineRuntimeVersion,
  skeleton: SkeletonLike,
  skinName: string,
) => {
  if (version === "4.2") {
    (skeleton as unknown as Skeleton42Like).setSkinByName(skinName);
  } else {
    (skeleton as unknown as Skeleton43Like).setSkin(skinName);
  }
};

export const resetSkeletonPose = (
  version: SpineRuntimeVersion,
  skeleton: SkeletonLike,
) => {
  if (version === "4.2") {
    (skeleton as unknown as Skeleton42Like).setToSetupPose();
  } else {
    (skeleton as unknown as Skeleton43Like).setupPose();
  }
};

export const resetSlotsToSetupPose = (
  version: SpineRuntimeVersion,
  skeleton: SkeletonLike,
) => {
  if (version === "4.2") {
    (skeleton as unknown as Skeleton42Like).setSlotsToSetupPose();
  } else {
    (skeleton as unknown as Skeleton43Like).setupPoseSlots();
  }
};

export const getSlotAttachment = (
  version: SpineRuntimeVersion,
  slot: SlotLike,
): object | null => {
  if (version === "4.2") {
    return (slot as unknown as Slot42Like).getAttachment();
  }
  return (slot as unknown as Slot43Like).pose.attachment;
};

// TrackEntry is what setAnimation returns on both runtimes. Only the members
// below are identical across 4.2 and 4.3: `additive` is 4.3-only (4.2 layers
// through the MixBlend enum, which 4.3's core no longer exports), and the
// per-track lookups differ too (4.2 has getCurrent, 4.3 has getTrack), so
// `tracks` is the only portable way to read an entry back.
export interface TrackEntryLike {
  trackIndex: number;
  // Compared by name to decide whether a setAnimation call is needed at all.
  animation: AnimationLike | null;
  loop: boolean;
  alpha: number;
  // Read-only here: these three decide whether toggling `loop` would move the
  // pose. Never assign to them -- the runtime keeps animationLast/mixTime in
  // step with trackTime, and writing it directly desynchronises event firing.
  trackTime: number;
  animationStart: number;
  animationEnd: number;
}

export interface AnimationStateDataLike {
  defaultMix: number;
}

export interface AnimationStateLike {
  timeScale: number;
  data: AnimationStateDataLike;
  // 4.3 declares this readonly and 4.2 mutable; indexed reads behave the same
  // in both. Never assign to it. It only ever grows -- clearTrack writes null
  // into a slot rather than shrinking the array -- so it is not a track count.
  tracks: (TrackEntryLike | null)[];
  setAnimation(track: number, name: string, loop: boolean): TrackEntryLike;
  clearTrack(track: number): void;
  apply(skeleton: SkeletonLike): unknown;
}

export interface SlotObjectLike {
  destroy(options?: unknown): void;
}

export interface SpineInstance extends Container {
  skeleton: SkeletonLike;
  state: AnimationStateLike;
  addSlotObject(slotName: string, object: unknown): void;
  removeSlotObject(slotName: string): void;
  getSlotObject(slotName: string): SlotObjectLike | null;
}

export interface TextureAtlasPageLike {
  name: string;
  setTexture(texture: unknown): void;
}

export interface TextureAtlasLike {
  pages: TextureAtlasPageLike[];
  dispose(): void;
}

export interface SpineRuntimeModule {
  Spine: new (skeletonData: SkeletonDataLike) => SpineInstance;
  TextureAtlas: new (atlasText: string) => TextureAtlasLike;
  AtlasAttachmentLoader: new (atlas: TextureAtlasLike) => unknown;
  SkeletonJson: new (attachmentLoader: unknown) => {
    readSkeletonData(json: unknown): SkeletonDataLike;
  };
  SkeletonBinary: new (attachmentLoader: unknown) => {
    readSkeletonData(buffer: Uint8Array): SkeletonDataLike;
  };
  SpineTexture: { from(source: TextureSource): unknown };
}

export const spineRuntimeStorageKey = "spine-viewer-runtime-version";

export const getStoredRuntimeVersion = (): SpineRuntimeVersion => {
  if (typeof window === "undefined") {
    return "4.3";
  }
  const stored = window.localStorage.getItem(spineRuntimeStorageKey);
  return stored === "4.2" ? "4.2" : "4.3";
};

export const setStoredRuntimeVersion = (version: SpineRuntimeVersion) => {
  window.localStorage.setItem(spineRuntimeStorageKey, version);
};

export const loadSpineRuntime = async (
  version: SpineRuntimeVersion,
): Promise<SpineRuntimeModule> => {
  const runtimeModule =
    version === "4.2"
      ? await import("@esotericsoftware/spine-pixi-v8-42")
      : await import("@esotericsoftware/spine-pixi-v8-43");
  return runtimeModule as unknown as SpineRuntimeModule;
};

export class RuntimeVersionMismatchError extends Error {
  detectedVersion: string;
  requiredRuntime: SpineRuntimeVersion;

  constructor(
    detectedVersion: string,
    requiredRuntime: SpineRuntimeVersion,
    activeRuntime: SpineRuntimeVersion,
  ) {
    super(
      `This file is Spine ${detectedVersion || "unknown"} and needs the ${requiredRuntime} runtime, but the viewer is running ${activeRuntime}.`,
    );
    this.name = "RuntimeVersionMismatchError";
    this.detectedVersion = detectedVersion;
    this.requiredRuntime = requiredRuntime;
  }
}

// Binary skeleton layout: int32 lowHash, int32 highHash, then a var-int
// length-prefixed UTF-8 version string (length 0 = null, 1 = empty string,
// n = n-1 bytes follow). See spine-core's BinaryInput.readString/readInt.
const readVarInt = (view: DataView, cursor: { i: number }) => {
  let b = view.getUint8(cursor.i++);
  let result = b & 0x7f;
  if (b & 0x80) {
    b = view.getUint8(cursor.i++);
    result |= (b & 0x7f) << 7;
    if (b & 0x80) {
      b = view.getUint8(cursor.i++);
      result |= (b & 0x7f) << 14;
      if (b & 0x80) {
        b = view.getUint8(cursor.i++);
        result |= (b & 0x7f) << 21;
        if (b & 0x80) {
          b = view.getUint8(cursor.i++);
          result |= (b & 0x7f) << 28;
        }
      }
    }
  }
  return result;
};

const detectBinarySkeletonVersion = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const cursor = { i: 8 };
  let byteCount = readVarInt(view, cursor);
  if (byteCount <= 1) {
    return "";
  }
  byteCount -= 1;
  const bytes = new Uint8Array(buffer, cursor.i, byteCount);
  return new TextDecoder().decode(bytes);
};

const detectJsonSkeletonVersion = async (file: File): Promise<string> => {
  const data = JSON.parse(await file.text()) as {
    skeleton?: { spine?: string };
  };
  return data.skeleton?.spine ?? "";
};

export const detectSkeletonVersion = (file: File): Promise<string> =>
  file.name.toLowerCase().endsWith(".skel")
    ? detectBinarySkeletonVersion(file)
    : detectJsonSkeletonVersion(file);

export const resolveRuntimeVersion = (
  versionString: string,
): SpineRuntimeVersion => {
  if (versionString.startsWith("4.2")) {
    return "4.2";
  }
  if (versionString.startsWith("4.3")) {
    return "4.3";
  }
  throw new Error(
    `Unsupported Spine version "${versionString || "unknown"}". Only 4.2.x and 4.3.x skeletons are supported.`,
  );
};
