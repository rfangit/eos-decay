// ============================================================================
// NPZ / NPY reader — parse numpy .npz files in the browser, no dependencies
// ============================================================================
// An .npz is a ZIP archive of .npy files. np.savez stores them UNCOMPRESSED
// (STORED); np.savez_compressed uses DEFLATE. We handle both: STORED is copied
// directly, DEFLATE is inflated via the browser's DecompressionStream.
//
// Each .npy is parsed into a typed array + shape. loadNPZ(url) returns
//   { <key>: { data: Float64Array|.., shape: [..], dtype: 'f8'|.. }, ... }
// with scalars exposed as length-1 arrays (read .data[0]).

// ── ZIP parsing ──────────────────────────────────────────────────────────────
// We read the End-Of-Central-Directory record, walk the central directory, and
// pull each local file. Enough of the spec to handle numpy's archives.

function u16(dv, o) { return dv.getUint16(o, true); }
function u32(dv, o) { return dv.getUint32(o, true); }

async function inflateRaw(bytes) {
  // Raw DEFLATE (no zlib header) — what ZIP stores.
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This .npz uses compression and DecompressionStream is unavailable. ' +
                    'Re-save with np.savez (uncompressed) or use a modern browser.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function unzip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  // Find End Of Central Directory (signature 0x06054b50), scanning from the end.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP/npz (no EOCD record).');

  const cdCount  = u16(dv, eocd + 10);
  const cdOffset = u32(dv, eocd + 16);

  const files = {};
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (u32(dv, p) !== 0x02014b50) throw new Error('Bad central directory entry.');
    const method   = u16(dv, p + 10);
    const compSize = u32(dv, p + 20);
    const nameLen  = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commLen  = u16(dv, p + 32);
    const localOff = u32(dv, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // Jump to the local header to find where the data actually begins.
    const lNameLen  = u16(dv, localOff + 26);
    const lExtraLen = u16(dv, localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);

    files[name] = method === 0 ? raw : await inflateRaw(raw);
    p += 46 + nameLen + extraLen + commLen;
  }
  return files;
}

// ── NPY parsing ──────────────────────────────────────────────────────────────
const DTYPE_MAP = {
  '<f8': Float64Array, '<f4': Float32Array,
  '<i8': null /* BigInt64 -> convert */, '<i4': Int32Array, '<i2': Int16Array,
  '<u4': Uint32Array, '<u1': Uint8Array, '|b1': Uint8Array,
};

function parseNPY(bytes) {
  // Magic: \x93NUMPY, then version, then header length, then a Python-dict header.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = bytes[6];
  let headerLen, headerStart;
  if (major === 1) { headerLen = dv.getUint16(8, true); headerStart = 10; }
  else             { headerLen = dv.getUint32(8, true); headerStart = 12; }
  const header = new TextDecoder().decode(bytes.subarray(headerStart, headerStart + headerLen));

  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  const shapeM = /'shape':\s*\(([^)]*)\)/.exec(header)[1].trim();
  const shape = shapeM.length
    ? shapeM.split(',').map(s => s.trim()).filter(s => s.length).map(Number)
    : [];

  const dataStart = headerStart + headerLen;
  const raw = bytes.subarray(dataStart);
  // Ensure correct alignment by copying into a fresh buffer.
  const aligned = raw.slice();

  let data;
  if (descr === '<i8') {
    const big = new BigInt64Array(aligned.buffer);
    data = Float64Array.from(big, v => Number(v));
  } else {
    const TA = DTYPE_MAP[descr];
    if (!TA) throw new Error('Unsupported dtype: ' + descr);
    data = new TA(aligned.buffer);
  }
  return { data, shape, dtype: descr.replace(/^[<|>]/, '') };
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function loadNPZ(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const files = await unzip(buf);
  const out = {};
  for (const [name, bytes] of Object.entries(files)) {
    const key = name.replace(/\.npy$/, '');
    out[key] = parseNPY(bytes);
  }
  return out;
}

// Parse an npz from an already-loaded ArrayBuffer (for drag-and-drop / file input).
export async function parseNPZBuffer(buf) {
  const files = await unzip(buf);
  const out = {};
  for (const [name, bytes] of Object.entries(files)) {
    out[name.replace(/\.npy$/, '')] = parseNPY(bytes);
  }
  return out;
}

// Convenience: pull a key as a plain JS number array (for Chart.js).
export function arr(npz, key) {
  const e = npz[key];
  return e ? Array.from(e.data) : null;
}
export function scalar(npz, key) {
  const e = npz[key];
  return e ? e.data[0] : null;
}
