// ESA WorldCover 2021 v200 (10 m) for the map area, read straight from the open COG on AWS
// (range requests into an overview level, ~80 m) and returned as one 8-bit grayscale PNG whose
// pixel values are the WorldCover class codes (10 trees, 20 shrub, 30 grass, 40 crop, 50 built,
// 60 bare, 80 water, 90 wetland). Land cover does not change: cached at the edge for a year.
import { fromUrl } from 'geotiff';
import zlib from 'node:zlib';

const COG = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N15E120_Map.tif';
const TILE = { west: 120, north: 18, deg: 3 };          // the COG covers 15-18N, 120-123E
export const AREA = [120.38, 16.08, 121.0, 16.99];       // west, south, east, north (must match js/config.js)
const TARGET_PPD = 1500;                                 // pixels per degree wanted (~74 m)

function png(gray, w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; Buffer.from(gray.buffer, gray.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Area, X-Size, X-Source');
  try {
    const tiff = await fromUrl(COG, { allowFullFile: false });
    const n = await tiff.getImageCount();
    let best = null;
    for (let i = 0; i < n; i++) {
      const im = await tiff.getImage(i);
      const ppd = im.getWidth() / TILE.deg;
      if (!best || Math.abs(Math.log(ppd / TARGET_PPD)) < Math.abs(Math.log(best.ppd / TARGET_PPD))) best = { im, ppd, i };
    }
    const { im, ppd } = best;
    const [W, S, E, N] = AREA;
    const win = [Math.round((W - TILE.west) * ppd), Math.round((TILE.north - N) * ppd), Math.round((E - TILE.west) * ppd), Math.round((TILE.north - S) * ppd)];
    const w = win[2] - win[0], h = win[3] - win[1];
    const data = await im.readRasters({ window: win, samples: [0], interleave: true });
    const gray = data instanceof Uint8Array ? data : Uint8Array.from(data);
    if (req.query?.meta) {
      const hist = {}; for (const v of gray) hist[v] = (hist[v] || 0) + 1;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ images: n, level: best.i, ppd, win, w, h, hist });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Area', AREA.join(','));
    res.setHeader('X-Size', `${w}x${h}`);
    res.setHeader('X-Source', 'ESA WorldCover 10m 2021 v200');
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=31536000, immutable');
    res.status(200).send(png(gray, w, h));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'land cover read failed', detail: String(e?.message || e).slice(0, 300), cause: String(e?.cause?.code || e?.cause?.message || '') });
  }
}
