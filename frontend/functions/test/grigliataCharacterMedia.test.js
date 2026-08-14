const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isTask07PlacementMediaVisible,
  normalizeTask07CharacterTokenIds,
  resolveTask07CharacterMediaEntry,
  resolveTask07PlacedTokenMediaEntry,
  sanitizeTask07CanonicalAvatarMedia,
  sanitizeTask07CanonicalTokenMedia,
} = require("../lib/grigliataCharacterMedia");

const canonicalMedia = (ownerUid, seed = "a", kind = "avatar") => {
  const assetId = `m_${seed.repeat(40)}`;
  const prefix = `media_assets/v1/signed-in/${ownerUid}/${assetId}/3`;
  const descriptor = (name, contentType = "image/webp", generation = "9") => ({
    path: `${prefix}/${name}`,
    generation,
    bytes: 100,
    contentType,
    width: 96,
    height: 96,
    downloadUrl: `https://legacy.example/${name}`,
  });
  return {
    schemaVersion: 1,
    contractVersion: 1,
    assetId,
    kind,
    state: "ready",
    generation: "3",
    audience: "signed-in",
    ownerUid,
    original: descriptor("original", "image/png"),
    variants: {
      thumbnail: descriptor("thumbnail"),
      thumbnail2x: descriptor("thumbnail2x"),
      card: descriptor("card"),
    },
    imageUrl: "https://legacy.example/root.png",
  };
};
const avatarMedia = (ownerUid, seed = "a") => (
  canonicalMedia(ownerUid, seed, "avatar")
);
const tokenMedia = (ownerUid, seed = "d") => (
  canonicalMedia(ownerUid, seed, "token")
);

test("character token IDs are bounded, deduplicated, and validated", () => {
  assert.deepEqual(
    normalizeTask07CharacterTokenIds([" token-1 ", "token-1", "token-2"]),
    ["token-1", "token-2"]
  );
  assert.equal(normalizeTask07CharacterTokenIds(["bad/id"]), null);
  assert.equal(normalizeTask07CharacterTokenIds("token-1"), null);
  assert.equal(normalizeTask07CharacterTokenIds(
    Array.from({length: 61}, (_, index) => `token-${index}`)
  ), null);
});

test("canonical avatar sanitization strips all legacy URLs", () => {
  const sanitized = sanitizeTask07CanonicalAvatarMedia(
    avatarMedia("peer-1"),
    "peer-1"
  );
  assert.ok(sanitized);
  assert.equal(JSON.stringify(sanitized).includes("https://"), false);
  assert.equal(sanitized.variants.thumbnail.path.endsWith("/thumbnail"), true);
  assert.equal(sanitized.variants.thumbnail.generation, "9");
  assert.equal(sanitizeTask07CanonicalAvatarMedia({
    ...avatarMedia("peer-1"),
    variants: {
      ...avatarMedia("peer-1").variants,
      thumbnail: {
        ...avatarMedia("peer-1").variants.thumbnail,
        generation: "invalid",
      },
    },
  }, "peer-1"), null);
});

test("character relation prefers characterId and falls back to ownerUid", () => {
  const characterUser = {
    characterId: "character-doc",
    media: avatarMedia("character-doc", "b"),
  };
  const ownerUser = {media: avatarMedia("owner-1", "c")};
  const tokenData = {
    tokenType: "character",
    ownerUid: "owner-1",
    characterId: "character-doc",
    imageUrl: "https://legacy.example/peer.png",
  };

  const characterEntry = resolveTask07CharacterMediaEntry({
    tokenId: "peer-token",
    tokenData,
    usersById: new Map([
      ["character-doc", characterUser],
      ["owner-1", ownerUser],
    ]),
  });
  const ownerEntry = resolveTask07CharacterMediaEntry({
    tokenId: "peer-token",
    tokenData,
    usersById: new Map([["owner-1", ownerUser]]),
  });
  assert.equal(characterEntry.media.ownerUid, "character-doc");
  assert.equal(ownerEntry.media.ownerUid, "owner-1");
  assert.deepEqual(Object.keys(characterEntry).sort(), ["media", "tokenId"]);
});

test("non-character and non-ready relations fail closed", () => {
  const user = {media: avatarMedia("owner-1")};
  assert.equal(resolveTask07CharacterMediaEntry({
    tokenId: "foe-token",
    tokenData: {tokenType: "foe", ownerUid: "owner-1"},
    usersById: new Map([["owner-1", user]]),
  }), null);
  assert.equal(resolveTask07CharacterMediaEntry({
    tokenId: "character-token",
    tokenData: {tokenType: "character", ownerUid: "owner-1"},
    usersById: new Map([[
      "owner-1",
      {media: {...avatarMedia("owner-1"), state: "processing"}},
    ]]),
  }), null);
  assert.equal(resolveTask07CharacterMediaEntry({
    tokenId: "character-token",
    tokenData: {
      tokenType: "character",
      ownerUid: "owner-1",
      imageUrl: "https://legacy.example/peer.png",
    },
    usersById: new Map([["owner-1", {imageUrl: "legacy-only"}]]),
  }), null);
});

test("visible placement media is available to players while hidden media is DM-only", () => {
  const placementData = {
    backgroundId: "map-1",
    tokenId: "token-1",
    ownerUid: "owner-1",
    isVisibleToPlayers: true,
  };
  assert.equal(isTask07PlacementMediaVisible({
    placementId: "map-1__token-1",
    backgroundId: "map-1",
    tokenId: "token-1",
    placementData,
    actorRole: "player",
  }), true);
  assert.equal(isTask07PlacementMediaVisible({
    placementId: "map-1__token-1",
    backgroundId: "map-1",
    tokenId: "token-1",
    placementData: {...placementData, isVisibleToPlayers: false},
    actorRole: "player",
  }), false);
  assert.equal(isTask07PlacementMediaVisible({
    placementId: "map-1__token-1",
    backgroundId: "map-1",
    tokenId: "token-1",
    placementData: {...placementData, isVisibleToPlayers: false},
    actorRole: "dm",
  }), true);
});

test("placed custom instances resolve only their same-owner template media", () => {
  const ownerUid = "owner-1";
  const tokenData = {
    tokenType: "custom",
    customTokenRole: "instance",
    customTemplateId: "template-1",
    ownerUid,
  };
  const template = {
    tokenType: "custom",
    customTokenRole: "template",
    customTemplateId: "template-1",
    ownerUid,
    media: tokenMedia(ownerUid),
  };
  const entry = resolveTask07PlacedTokenMediaEntry({
    tokenId: "instance-1",
    tokenData,
    templatesById: new Map([["template-1", template]]),
    usersById: new Map(),
  });
  assert.equal(entry.media.kind, "token");
  assert.equal(entry.media.ownerUid, ownerUid);
  assert.equal(JSON.stringify(entry).includes("https://"), false);

  assert.equal(resolveTask07PlacedTokenMediaEntry({
    tokenId: "instance-1",
    tokenData,
    templatesById: new Map([[
      "template-1",
      {...template, ownerUid: "other-owner"},
    ]]),
    usersById: new Map(),
  }), null);
  assert.ok(sanitizeTask07CanonicalTokenMedia(tokenMedia(ownerUid), ownerUid));
});
