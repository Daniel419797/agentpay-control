import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const markSource =
  "C:/Users/HomePC/.codex/generated_images/019f867d-e7fd-7ff3-afaf-9c36faac352d/call_LWk3NgGdZpjzXZeWpMtBKDdq.png";
const lockupSource =
  "C:/Users/HomePC/.codex/generated_images/019f867d-e7fd-7ff3-afaf-9c36faac352d/call_WrhMNQmMNBKGhqILA2vIivmd.png";
const brandDir = path.join(root, "public", "brand");

await fs.mkdir(brandDir, { recursive: true });

async function removeLightBackground(source) {
  const { data, info } = await sharp(source)
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 4);

  for (let inputIndex = 0, outputIndex = 0; inputIndex < data.length; inputIndex += 3, outputIndex += 4) {
    const luminance =
      data[inputIndex] * 0.2126 +
      data[inputIndex + 1] * 0.7152 +
      data[inputIndex + 2] * 0.0722;
    const alpha = luminance >= 247 ? 0 : luminance <= 205 ? 255 : Math.round(((247 - luminance) / 42) * 255);
    output[outputIndex] = 0;
    output[outputIndex + 1] = 0;
    output[outputIndex + 2] = 0;
    output[outputIndex + 3] = alpha;
  }

  return sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
}

async function saveVariants(source, basename, width) {
  const transparentImage = await removeLightBackground(source);
  const transparent = await transparentImage.png().toBuffer();
  const black = sharp(transparent).resize({ width, withoutEnlargement: true });
  const blackBuffer = await black.png({ compressionLevel: 9 }).toBuffer();

  await fs.writeFile(path.join(brandDir, `${basename}.png`), blackBuffer);
  await sharp(blackBuffer)
    .ensureAlpha()
    .negate({ alpha: false })
    .png({ compressionLevel: 9 })
    .toFile(path.join(brandDir, `${basename}-white.png`));

  return blackBuffer;
}

const mark = await saveVariants(markSource, "agentpay-mark", 512);
await saveVariants(lockupSource, "agentpay-lockup", 1200);

await sharp(mark)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(path.join(root, "src", "app", "icon.png"));

await Promise.all(
  ["preview-agentpay-mark.png", "preview-agentpay-lockup.png"].map((filename) =>
    fs.rm(path.join(brandDir, filename), { force: true }),
  ),
);
