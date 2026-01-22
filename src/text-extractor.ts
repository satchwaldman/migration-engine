import * as fs from 'fs';
import * as path from 'path';

// Use require for libraries without proper TS types
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Approximate characters per page (for estimating page count from text)
 */
const CHARS_PER_PAGE = 3000;

/**
 * Max characters to extract (roughly 5 pages)
 */
const MAX_CHARS = 15000;

/**
 * Extract text content from various file types
 * Returns the first ~5 pages worth of text for classification
 */
export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);
  const stats = fs.statSync(filePath);
  
  try {
    switch (ext) {
      case '.pdf':
        return await extractFromPdf(filePath);
      
      case '.docx':
        return await extractFromDocx(filePath);
      
      case '.txt':
      case '.md':
      case '.json':
      case '.js':
      case '.ts':
      case '.py':
      case '.html':
      case '.css':
      case '.csv':
      case '.xml':
      case '.yaml':
      case '.yml':
        return extractFromTextFile(filePath);
      
      default:
        // For unsupported types, just return filename info
        return `[File: ${filename}, type: ${ext}, size: ${(stats.size / 1024).toFixed(1)} KB]`;
    }
  } catch (err) {
    // If extraction fails, fall back to filename
    return `[File: ${filename}, type: ${ext}, size: ${(stats.size / 1024).toFixed(1)} KB, extraction failed: ${err}]`;
  }
}

/**
 * Extract text from PDF (first ~5 pages)
 */
async function extractFromPdf(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  
  // pdf-parse options - we'll get all text then truncate
  const data = await pdfParse(dataBuffer, {
    max: 5, // Only parse first 5 pages
  });
  
  let text = data.text || '';
  
  // Clean up excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  
  // Truncate if still too long
  if (text.length > MAX_CHARS) {
    text = text.substring(0, MAX_CHARS) + '\n[... truncated ...]';
  }
  
  // Add metadata
  const pageInfo = data.numpages > 5 ? ` (showing first 5 of ${data.numpages} pages)` : '';
  return `[PDF${pageInfo}]\n\n${text}`;
}

/**
 * Extract text from DOCX
 */
async function extractFromDocx(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  let text = result.value || '';
  
  // Clean up excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  
  // Truncate if too long (approximately first 5 pages)
  if (text.length > MAX_CHARS) {
    text = text.substring(0, MAX_CHARS) + '\n[... truncated ...]';
  }
  
  return `[DOCX]\n\n${text}`;
}

/**
 * Extract text from plain text files
 */
function extractFromTextFile(filePath: string): Promise<string> {
  let text = fs.readFileSync(filePath, 'utf-8');
  
  // Truncate if too long
  if (text.length > MAX_CHARS) {
    text = text.substring(0, MAX_CHARS) + '\n[... truncated ...]';
  }
  
  return Promise.resolve(text);
}

/**
 * Check if a file type is supported for text extraction
 */
export function isExtractionSupported(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const supported = [
    '.pdf', '.docx',
    '.txt', '.md', '.json', '.js', '.ts', '.py', 
    '.html', '.css', '.csv', '.xml', '.yaml', '.yml'
  ];
  return supported.includes(ext);
}
