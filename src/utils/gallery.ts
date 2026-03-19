import { readdir } from "node:fs/promises";
import sharp from "sharp";

const GALLERY_FILE_PATTERN = /\.(jpe?g|png|webp|avif)$/i;
const HOME_SLIDER_PATTERN = /^gal(\d+)\.(jpe?g|png|webp|avif)$/i;
const GALLERY_EXCLUDED_FILES = new Set([
  "hero-mobile.jpg",
  "image-hero.jpg",
  "logo-transparent.png",
  "pp.jpg",
  "precious.jpeg",
  "profil.jpg",
]);
const CURATED_GALLERY_ORDER = [
  "gal1.jpg",
  "gal2.jpg",
  "gal3.jpg",
  "gal4.jpg",
  "gal5.jpg",
  "gal6.jpeg",
  "gal7.jpeg",
  "eee.jpeg",
  "ivgv .jpeg",
  "jyjvjgv .jpeg",
  "dxdx.jpeg",
  "hgfdw.jpeg",
  "poo.jpeg",
  "drrr.jpeg",
  "vcvcxcxc.jpeg",
  "wxcvb.jpeg",
];

function normalizeGalleryName(name: string): string {
  return name.trim().toLowerCase();
}

const curatedGalleryOrderIndex = new Map(
  CURATED_GALLERY_ORDER.map((name, index) => [normalizeGalleryName(name), index])
);

export interface GalleryItem {
  height: number;
  name: string;
  ratio: number;
  width: number;
}

export async function getGalleryImages(limit?: number): Promise<string[]> {
  try {
    const files = (await readdir(`${process.cwd()}/public`, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter(
        (name) =>
          GALLERY_FILE_PATTERN.test(name) &&
          !GALLERY_EXCLUDED_FILES.has(name.trim().toLowerCase())
      )
      .sort((a, b) => {
        const normalizedA = normalizeGalleryName(a);
        const normalizedB = normalizeGalleryName(b);
        const curatedIndexA = curatedGalleryOrderIndex.get(normalizedA);
        const curatedIndexB = curatedGalleryOrderIndex.get(normalizedB);

        if (curatedIndexA !== undefined && curatedIndexB !== undefined) {
          return curatedIndexA - curatedIndexB;
        }

        if (curatedIndexA !== undefined) return -1;
        if (curatedIndexB !== undefined) return 1;

        return normalizedA.localeCompare(normalizedB, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

    if (typeof limit === "number") {
      return files.slice(0, Math.max(0, limit));
    }

    return files;
  } catch {
    return [];
  }
}

function toGalIndex(name: string): number | null {
  const match = name.match(HOME_SLIDER_PATTERN);
  if (!match) return null;
  return Number.parseInt(match[1] ?? "", 10);
}

function isPhotoSeriesFile(name: string): boolean {
  return name.trim().toUpperCase().startsWith("PHOTO-");
}

export async function getHomeSliderImages(limit = 5): Promise<string[]> {
  const files = await getGalleryImages();
  const sliderLimit = Math.max(0, limit);

  const orderedGalFiles = files
    .map((name) => ({ index: toGalIndex(name), name }))
    .filter((entry): entry is { index: number; name: string } => Number.isFinite(entry.index))
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.name);

  const remainingFiles = files.filter((name) => toGalIndex(name) === null);
  const curatedFiles = remainingFiles.filter((name) => !isPhotoSeriesFile(name));
  const photoSeriesFiles = remainingFiles.filter((name) => isPhotoSeriesFile(name));
  const orderedFiles = orderedGalFiles.length > 0
    ? [...orderedGalFiles, ...curatedFiles, ...photoSeriesFiles]
    : [...curatedFiles, ...photoSeriesFiles];

  return orderedFiles.slice(0, sliderLimit);
}

export async function getGalleryItems(limit?: number): Promise<GalleryItem[]> {
  const files = await getGalleryImages(limit);
  const items: GalleryItem[] = [];

  for (const name of files) {
    try {
      const metadata = await sharp(`${process.cwd()}/public/${name}`).metadata();
      const width = metadata.width ?? 1;
      const height = metadata.height ?? 1;
      if (!width || !height) continue;
      items.push({
        height,
        name,
        ratio: width / height,
        width,
      });
    } catch {
      // Skip unreadable files to keep gallery rendering resilient.
    }
  }

  return items;
}
