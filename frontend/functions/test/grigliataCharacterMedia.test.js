const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeTask07CharacterTokenIds,
  resolveTask07CharacterMediaEntry,
  sanitizeTask07CanonicalAvatarMedia,
} = require("../lib/grigliataCharacterMedia");

const avatarMedia = (ownerUid, seed = "a") => {
  const assetId = `m_${seed.repeat(40)}`;
  const prefix = `media_assets/v1/signed-in/${ownerUid}/${assetId}/3`;
  const descriptor = (name, contentType = "image/webp") => ({
    path: `${prefix}/${name}`,
    generation: "3",
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
    kind: "avatar",
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
