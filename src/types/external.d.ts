// src/types/external.d.ts

// Fixes for external libraries without official type definitions
declare module "pdfkit" {
  const PDFDocument: any;
  export = PDFDocument;
}

declare module "nodemailer" {
  const nodemailer: any;
  export = nodemailer;
}
