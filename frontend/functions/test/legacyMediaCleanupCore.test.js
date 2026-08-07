const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectLegacyMediaPaths,
  documentContainsLegacyMediaPath,
  isLegacyMediaPathAllowed,
  planLegacyMediaCleanup,
  storagePathFromLegacyMediaValue,
} = require("../lib/legacyMediaCleanupCore");

const firebaseUrl = (path) => (
  "https://firebasestorage.googleapis.com/v0/b/demo/o/" +
  `${encodeURIComponent(path)}?alt=media&token=private`
);

test("legacy paths are normalized without admitting canonical or foreign URLs", () => {
  assert.equal(
    storagePathFromLegacyMediaValue(firebaseUrl("items/old sword.webp")),
    "items/old sword.webp"
  );
  assert.equal(
    storagePathFromLegacyMediaValue("gs://demo.appspot.com/foes/wolf.png"),
    "foes/wolf.png"
  );
  assert.equal(
    storagePathFromLegacyMediaValue("https://example.test/o/items%2Ftrap.png"),
    ""
  );
  assert.equal(
    storagePathFromLegacyMediaValue(
      "media_assets/v1/dm-only/dm/asset/generation/original"
    ),
    ""
  );
  assert.equal(
    storagePathFromLegacyMediaValue(
      "media/v1/item/dm/asset/original/source.png"
    ),
    ""
  );
  assert.equal(storagePathFromLegacyMediaValue("items/../secret.png"), "");
});

test("catalog replacements include nested spell media and preserve live paths", () => {
  const before = {
    General: {
      image_url: firebaseUrl("items/weapon_sword_old.webp"),
      spells: {
        Flame: {
          image_url: firebaseUrl("spells/spell_sword_flame-old.webp"),
          video_url: firebaseUrl("spells/videos/spell_sword_flame-loop.mp4"),
        },
      },
    },
  };
  const after = {
    General: {
      image_url: firebaseUrl("items/weapon_sword_new.webp"),
      spells: {
        Flame: {
          video_url: firebaseUrl("spells/videos/spell_sword_flame-loop.mp4"),
        },
      },
    },
  };
  assert.deepEqual(planLegacyMediaCleanup({
    before,
    after,
    referencePath: "items/sword",
    scope: "catalog-item",
  }), [
    "items/weapon_sword_old.webp",
    "spells/spell_sword_flame-old.webp",
  ]);
  assert.equal(
    documentContainsLegacyMediaPath(after, "items/weapon_sword_new.webp"),
    true
  );
  assert.equal(
    documentContainsLegacyMediaPath(after, "items/weapon_sword_old.webp"),
    false
  );
});

test("only owner-bound profile paths can enter server cleanup", () => {
  assert.equal(isLegacyMediaPathAllowed({
    path: "characters/hero_user-1_1234",
    referencePath: "users/user-1",
    scope: "profile",
  }), true);
  assert.equal(isLegacyMediaPathAllowed({
    path: "characters/hero_user-2_1234",
    referencePath: "users/user-1",
    scope: "profile",
  }), false);
  assert.equal(isLegacyMediaPathAllowed({
    path: "users/user-1/profile/avatar.webp",
    referencePath: "users/user-1",
    scope: "profile",
  }), true);
  assert.equal(isLegacyMediaPathAllowed({
    path: "users/user-2/profile/avatar.webp",
    referencePath: "users/user-1",
    scope: "profile",
  }), false);
});

test("catalog cleanup cannot delete media owned by a personal spell", () => {
  assert.equal(isLegacyMediaPathAllowed({
    path: "spells/spell_sword_Flame_1_image",
    referencePath: "items/sword",
    scope: "catalog-item",
  }), true);
  assert.equal(isLegacyMediaPathAllowed({
    path: "spells/spell_user-1_Flame_1_image",
    referencePath: "items/sword",
    scope: "catalog-item",
  }), false);
  assert.equal(isLegacyMediaPathAllowed({
    path: "items/varie_user-1_custom.webp",
    referencePath: "items/sword",
    scope: "catalog-item",
  }), false);
});

test("custom-token templates own media while shared instances and copies do not", () => {
  const referencePath = "grigliata_tokens/token-1";
  const media = {
    ownerUid: "user-1",
    tokenType: "custom",
    customTokenRole: "template",
    imageSource: "uploaded",
    imagePath: "grigliata/tokens/user-1/wolf.png",
  };
  assert.deepEqual(collectLegacyMediaPaths({
    referencePath,
    scope: "token",
    value: media,
  }), ["grigliata/tokens/user-1/wolf.png"]);
  assert.deepEqual(collectLegacyMediaPaths({
    referencePath,
    scope: "token",
    value: {...media, customTokenRole: "instance"},
  }), []);
  assert.deepEqual(collectLegacyMediaPaths({
    referencePath,
    scope: "token",
    value: {
      ...media,
      tokenType: "character",
      imageSource: "profile",
      imagePath: "characters/hero_user-1_1234",
    },
  }), []);
  assert.deepEqual(collectLegacyMediaPaths({
    referencePath,
    scope: "token",
    value: {
      ...media,
      imagePath: "grigliata/tokens/user-2/stolen.png",
    },
  }), []);
});

test("media-looking text outside explicit media fields is never collected", () => {
  assert.deepEqual(collectLegacyMediaPaths({
    referencePath: "foes/wolf",
    scope: "foe",
    value: {
      notes: "foes/not-a-real-image.png",
      imagePath: "foes/real-image.png",
    },
  }), ["foes/real-image.png"]);
});

test("every current legacy UI upload root has an owning cleanup scope", () => {
  const cases = [
    {
      path: "characters/hero_user-1_1",
      referencePath: "users/user-1",
      scope: "profile",
    },
    {
      path: "items/weapon_sword_1_image.png",
      referencePath: "items/sword",
      scope: "catalog-item",
    },
    {
      path: "echi_npcs/dm-1/npc.png",
      referencePath: "echi_npcs/npc-1",
      scope: "npc",
    },
    {
      path: "foes/tecniche/claw.png",
      referencePath: "foes/wolf",
      scope: "foe",
    },
    {
      path: "grigliata/backgrounds/dm-1/map.png",
      referencePath: "grigliata_backgrounds/map-1",
      scope: "background",
    },
    {
      path: "grigliata/music/dm-1/theme.mp3",
      referencePath: "grigliata_music_tracks/track-1",
      scope: "music-track",
    },
    {
      ownerUid: "user-1",
      path: "grigliata/tokens/user-1/wolf.png",
      referencePath: "grigliata_tokens/token-1",
      scope: "token",
    },
  ];
  cases.forEach((entry) => assert.equal(
    isLegacyMediaPathAllowed(entry),
    true,
    `${entry.scope}: ${entry.path}`
  ));
});
