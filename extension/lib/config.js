// Central configuration. Fork maintainers: change the URLs below.
export const CONFIG = {
  name: 'StickStack',
  version: '1.0.0',
  repoUrl: 'https://github.com/YOUR_GITHUB_USERNAME/stickstack',
  issuesUrl: 'https://github.com/YOUR_GITHUB_USERNAME/stickstack/issues',
  coffeeUrl: 'https://buymeacoffee.com/YOUR_BMC_USERNAME',
  converterUrl: 'https://YOUR_GITHUB_USERNAME.github.io/stickstack/web/',
};

export const LIMITS = {
  maxImageBytes: 10 * 1024 * 1024, // a single sticker/image file
  maxArchiveBytes: 300 * 1024 * 1024, // a single .zip / .wastickers
  maxArchiveTotalBytes: 600 * 1024 * 1024, // everything unpacked in one import
  maxArchiveEntries: 5000,
  maxArchiveDepth: 2, // zip inside zip inside import
  maxFrames: 400, // frames kept when converting an animation
  minSide: 16, // px — smaller than this is not a sticker
  maxSide: 8192, // px — refuse absurd dimensions (decompression bombs)
  substackImagesPerNote: 6,
};
