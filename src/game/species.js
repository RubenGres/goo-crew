// Species stats shared by the simulation (node-safe, no three.js imports) and
// the character art layer. Visual builds live in art/character.js.

export const SPECIES = {
  noodler: {
    label: "NOODLER",
    desc: "All-rounder. Long of limb, loose of joint.",
    hp: 100,
    speed: 1.35, // tiles per second
    repair: 1.0,
    douse: 1.0,
    o2Immune: false,
  },
  gloop: {
    label: "GLOOP",
    desc: "A hopping custard. Smothers fires with its body.",
    hp: 120,
    speed: 0.95,
    repair: 0.85,
    douse: 1.9,
    o2Immune: false,
  },
  skitter: {
    label: "SKITTER",
    desc: "Four legs, zero patience. Fastest crew alive.",
    hp: 75,
    speed: 2.1,
    repair: 1.15,
    douse: 0.9,
    o2Immune: false,
  },
  bolt: {
    label: "BOLT-E",
    desc: "Floating maintenance bot. Doesn't breathe, can't be healed fast.",
    hp: 85,
    speed: 1.2,
    repair: 1.5,
    douse: 1.2,
    o2Immune: true,
  },
};

export const SPECIES_KEYS = Object.keys(SPECIES);

const FIRST = ["Zib", "Plo", "Mek", "Sog", "Dib", "Yun", "Kip", "Wug", "Fizz", "Nib", "Tam", "Osh", "Bem", "Lud", "Quix", "Rin"];
const LAST = ["Noodle", "Sprocket", "Broth", "Dumpling", "Wobble", "Splat", "Girder", "Soup", "Twist", "Ladle", "Crouton", "Gloop"];

export function crewName(rand) {
  return `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
}

export const CREW_COLORS = [0xffb84b, 0x4be0e8, 0x6fe86b, 0xb48bff, 0xff7d9c, 0x8fd0ff, 0xffe066, 0x7dffcf];
