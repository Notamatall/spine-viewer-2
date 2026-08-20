import {
  resetSkeletonPose,
  type SpineInstance,
  type SpineRuntimeVersion,
  type TrackEntryLike,
} from "./spineRuntime";

// A track's runtime index is its position in the array. There is deliberately
// no `trackIndex` field: a stored index is a second source of truth that goes
// stale the moment a track is added or removed.
export type AnimationTrack = {
  // Stable React key, not the track index.
  id: string;
  // "" means the track is cleared.
  animation: string;
  loop: boolean;
  // Layer weight 0..1. Forced to 1 on track 0, which must pose the skeleton
  // fully for the tracks above it to blend against.
  alpha: number;
};

export const maxTracks = 6;

let nextTrackId = 0;

export const createTrack = (
  animation = "",
  overrides: Partial<Omit<AnimationTrack, "id">> = {},
): AnimationTrack => ({
  id: `track-${(nextTrackId += 1)}`,
  animation,
  loop: true,
  alpha: 1,
  ...overrides,
});

// Every reader assumes a track list is never empty.
export const createInitialTracks = (): AnimationTrack[] => [createTrack()];

export const setTrackAt = (
  tracks: AnimationTrack[],
  index: number,
  patch: Partial<Omit<AnimationTrack, "id">>,
): AnimationTrack[] =>
  tracks.map((track, i) => (i === index ? { ...track, ...patch } : track));

export const addTrack = (tracks: AnimationTrack[]): AnimationTrack[] =>
  tracks.length >= maxTracks ? tracks : [...tracks, createTrack()];

export const removeTrackAt = (
  tracks: AnimationTrack[],
  index: number,
): AnimationTrack[] => {
  const next = tracks.filter((_, i) => i !== index);
  return next.length > 0 ? next : createInitialTracks();
};

// Copies a list onto a different skeleton: fresh ids so no two slots share
// object identity, and clips the target skeleton doesn't have are blanked here
// in state rather than only at apply time -- otherwise a controlled
// <select value="attack"> renders with no matching <option> and the browser
// silently displays the first one while state claims something else.
export const cloneTracks = (
  tracks: AnimationTrack[],
  animations: string[],
): AnimationTrack[] =>
  tracks.map((track) =>
    createTrack(animations.includes(track.animation) ? track.animation : "", {
      loop: track.loop,
      alpha: track.alpha,
    }),
  );

export const hasAnyAnimation = (tracks: AnimationTrack[]) =>
  tracks.some((track) => track.animation !== "");

const clampAlpha = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;

const resolveAlpha = (index: number, alpha: number) =>
  index === 0 ? 1 : clampAlpha(alpha);

// A looping entry maps trackTime through a modulo wrap, a non-looping one
// clamps it to the clip's end. The two agree exactly while the clip is still
// inside its first cycle, so `loop` can be flipped in place there. Past that
// they resolve to different frames, and mutating in place would snap the pose
// to the last frame (or out of it) rather than just changing the repeat.
const loopChangeIsContinuous = (entry: TrackEntryLike) => {
  const duration = entry.animationEnd - entry.animationStart;
  return duration <= 0 || entry.trackTime < duration;
};

export type ApplyTracksOptions = {
  version: SpineRuntimeVersion;
  spine: SpineInstance;
  tracks: AnimationTrack[];
  // Clips this skeleton actually has; anything else is treated as cleared.
  animations: string[];
  isPlaying: boolean;
  defaultMix: number;
};

/**
 * Reconciles `spine.state` to `tracks`. This is a diff, not a command: it
 * compares each track against the live entry and issues setAnimation/clearTrack
 * only where the clip actually differs, so it is safe to call from an effect,
 * under StrictMode's double mount, and repeatedly while a slider is dragged.
 *
 * Returns true only when the track structure changed, so callers can re-centre
 * the sprite on a clip change without re-pivoting it on every alpha step.
 */
export const applyTracks = ({
  version,
  spine,
  tracks,
  animations,
  isPlaying,
  defaultMix,
}: ApplyTracksOptions): boolean => {
  const state = spine.state;
  state.timeScale = isPlaying ? 1 : 0;
  // Must be written before any setAnimation below: an entry resolves its mix
  // duration from data.getMix() once, when it is created.
  state.data.defaultMix = Math.max(0, defaultMix);

  const known = new Set(animations);
  let structural = false;
  let cleared = false;

  tracks.forEach((track, index) => {
    // Both runtimes throw on an unknown clip name, and a throw here would
    // abort the reconcile with the skeleton half-applied. Track lists outlive
    // skeletons (slot reloads, copy-to-all), so names are always re-validated.
    const wanted = known.has(track.animation) ? track.animation : "";
    const current = state.tracks[index] ?? null;

    if (!wanted) {
      if (current) {
        state.clearTrack(index);
        structural = true;
        cleared = true;
      }
      return;
    }

    let entry = current;
    if (
      !entry ||
      entry.animation?.name !== wanted ||
      (entry.loop !== track.loop && !loopChangeIsContinuous(entry))
    ) {
      // Write to the entry setAnimation returns, never to a handle read before
      // the call: the old entry becomes `mixingFrom` and mutating it would
      // change the outgoing animation instead.
      entry = state.setAnimation(index, wanted, track.loop);
      structural = true;
    }
    // Both fields are re-read every frame, so where the guard above let us
    // through these take effect without restarting from trackTime 0.
    entry.loop = track.loop;
    entry.alpha = resolveAlpha(index, track.alpha);
  });

  // Tracks the user removed. Bounded by state.tracks.length, which only grows.
  for (let index = tracks.length; index < state.tracks.length; index += 1) {
    if (state.tracks[index]) {
      state.clearTrack(index);
      structural = true;
      cleared = true;
    }
  }

  if (structural) {
    if (cleared) {
      // clearTrack leaves the skeleton in its current pose, so whatever the
      // removed layer was posing would otherwise stay frozen on screen when no
      // remaining track keys it. Reset first, then let the surviving tracks
      // re-pose from setup.
      resetSkeletonPose(version, spine.skeleton);
    }
    // Pose the skeleton now so a caller measuring getLocalBounds() sees the new
    // pose; Pixi's ticker would otherwise only apply the state next frame and
    // centring would pivot off the previous one.
    state.apply(spine.skeleton);
  }
  return structural;
};

// Escape hatch for replaying a track: the reconciler deliberately does not
// restart on a name match, so a finished non-looping clip is otherwise stuck.
export const restartTrack = (
  spine: SpineInstance,
  tracks: AnimationTrack[],
  index: number,
  animations: string[],
) => {
  const track = tracks[index];
  if (!track?.animation || !animations.includes(track.animation)) {
    return;
  }
  const entry = spine.state.setAnimation(index, track.animation, track.loop);
  entry.alpha = resolveAlpha(index, track.alpha);
};
