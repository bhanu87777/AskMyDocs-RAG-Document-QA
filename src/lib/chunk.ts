export interface PageText {
  page: number; // 1-indexed; 1 for non-paginated formats
  text: string;
}

export interface RawChunk {
  content: string;
  page: number;
}

// Split a page into topically-coherent blocks: markdown headings start a new
// block, and blank lines separate paragraphs. Keeping blocks aligned to the
// document's structure gives each chunk a focused meaning — which is what makes
// embedding-based retrieval precise.
function splitIntoBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const joined = current.join(" ").replace(/\s+/g, " ").trim();
    if (joined) blocks.push(joined);
    current = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      flush(); // blank line = paragraph boundary
    } else if (/^#{1,6}\s/.test(line)) {
      flush(); // markdown heading starts a new block
      current.push(line.replace(/^#{1,6}\s/, ""));
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

// Pack structural blocks into chunks up to `maxChars`. Small adjacent blocks are
// merged; oversized blocks are split on word boundaries with overlap.
export function chunkPages(
  pages: PageText[],
  { maxChars = 450, overlap = 80 }: { maxChars?: number; overlap?: number } = {},
): RawChunk[] {
  const chunks: RawChunk[] = [];

  for (const { page, text } of pages) {
    const blocks = splitIntoBlocks(text);
    let buffer = "";

    const pushBuffer = () => {
      const content = buffer.trim();
      if (content) chunks.push({ content, page });
      buffer = "";
    };

    for (const block of blocks) {
      // Oversized single block → hard-split it.
      if (block.length > maxChars) {
        pushBuffer();
        let start = 0;
        while (start < block.length) {
          let end = Math.min(start + maxChars, block.length);
          if (end < block.length) {
            const lastSpace = block.lastIndexOf(" ", end);
            if (lastSpace > start + maxChars * 0.6) end = lastSpace;
          }
          chunks.push({ content: block.slice(start, end).trim(), page });
          if (end >= block.length) break;
          start = Math.max(end - overlap, start + 1);
        }
        continue;
      }

      // Would exceed the limit → flush and start fresh with this block.
      if (buffer && buffer.length + block.length + 1 > maxChars) {
        pushBuffer();
      }
      buffer = buffer ? `${buffer} ${block}` : block;
    }
    pushBuffer();
  }

  return chunks;
}
