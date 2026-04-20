import { readdir, readFile } from "node:fs/promises"
import { join, extname, basename } from "node:path"

export interface ImageSample {
  path: string
  label: string
  raw: number[]
}

export interface ImageLoadOpts {
  dir: string
  extensions?: string[]
  sampleShape?: number[]
  decodeImage?: (buffer: Buffer, meta: { path: string; width: number; height: number; channels: number }) => Promise<number[] | unknown>
}

const DEFAULT_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"]

export async function loadImages(opts: ImageLoadOpts): Promise<{ samples: ImageSample[]; errors: string[] }> {
  const { dir, extensions = DEFAULT_EXTENSIONS, sampleShape, decodeImage } = opts

  // Dynamic import to avoid requiring sharp when not using image loader
  const sharp = (await import("sharp")).default

  const entries = await readdir(dir, { withFileTypes: true })
  const labelDirs = entries.filter((e) => e.isDirectory())

  if (labelDirs.length === 0) {
    throw new Error(`No label subdirectories found in "${dir}". Expected structure: dir/{label}/*.jpg`)
  }

  const samples: ImageSample[] = []
  const errors: string[] = []

  for (const labelDir of labelDirs) {
    const label = labelDir.name
    const labelPath = join(dir, label)
    const files = await readdir(labelPath, { withFileTypes: true })

    for (const file of files) {
      if (!file.isFile()) continue
      const ext = extname(file.name).toLowerCase()
      if (!extensions.includes(ext)) continue

      const filePath = join(labelPath, file.name)
      try {
        const buffer = await readFile(filePath)
        let raw: number[]

        if (decodeImage) {
          const img = sharp(buffer)
          const meta = await img.metadata()
          const result = await decodeImage(buffer, {
            path: filePath,
            width: meta.width ?? 0,
            height: meta.height ?? 0,
            channels: meta.channels ?? 3,
          })
          raw = Array.isArray(result) ? result as number[] : [...(result as Iterable<number>)]
        } else {
          // Default: decode to normalized float array, reshape to sampleShape if given
          const img = sharp(buffer).removeAlpha()
          const meta = await img.metadata()
          const w = meta.width ?? 0
          const h = meta.height ?? 0

          let target = img
          if (sampleShape && sampleShape.length === 2) {
            const [sh, sw] = sampleShape
            if (sh && sw) target = target.resize(sw, sh)
          }

          const { data } = await target.raw().toBuffer({ resolveWithObject: true })
          raw = Array.from(data).map((v) => v / 255)
        }

        samples.push({ path: filePath, label, raw })
      } catch (e) {
        errors.push(`${filePath}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return { samples, errors }
}
