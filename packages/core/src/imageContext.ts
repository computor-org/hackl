// Only inline, bounded images. Remote image URLs would let untrusted context
// ask a provider to fetch arbitrary URLs and would hide what leaves the editor.
export function validateImageDataUrls(images: readonly string[] = []): readonly string[] {
  if (!Array.isArray(images) || images.length > 3) throw new Error("Attach at most three plot images");
  return Object.freeze(images.map(image => {
    if (typeof image !== "string" || image.length > 2800000) throw new Error("Plot image exceeds the 2 MB limit");
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match || match[2].length % 4 !== 0) throw new Error("Plot images must be inline PNG, JPEG or WebP");
    const bytes = Buffer.from(match[2], "base64");
    const valid = match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : match[1] === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!valid || bytes.length > 2 * 1024 * 1024) throw new Error("Invalid plot image");
    return image;
  }));
}
