import { jsPDF } from 'jspdf';

interface BillVendor {
  businessName: string;
  category: string;
  basePrice: number;
}

interface BillData {
  bookingId: string;
  eventType: string;
  eventDate: Date | null;
  guestCount: number | null;
  location: string | null;
  vendors: BillVendor[];
  subtotal: number;
  serviceCharge: number;
  totalAmount: number;
  createdAt: Date;
}

function formatNaira(amount: number): string {
  return `NGN ${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateBookingBillPdf(bill: BillData): Buffer {
  const doc = new jsPDF();
  let y = 20;

  doc.setFontSize(18);
  doc.text('Nkwado — Booking Bill', 14, y);
  y += 10;

  doc.setFontSize(10);
  doc.text(`Booking ID: ${bill.bookingId}`, 14, y);
  y += 6;
  doc.text(`Date issued: ${bill.createdAt.toISOString().slice(0, 10)}`, 14, y);
  y += 10;

  doc.setFontSize(13);
  doc.text('Event Details', 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Event type: ${bill.eventType}`, 14, y);
  y += 6;
  if (bill.eventDate) {
    doc.text(`Event date: ${bill.eventDate.toISOString().slice(0, 10)}`, 14, y);
    y += 6;
  }
  if (bill.guestCount) {
    doc.text(`Guest count: ${bill.guestCount}`, 14, y);
    y += 6;
  }
  if (bill.location) {
    doc.text(`Location: ${bill.location}`, 14, y);
    y += 6;
  }
  y += 4;

  doc.setFontSize(13);
  doc.text('Selected Vendors', 14, y);
  y += 7;
  doc.setFontSize(10);
  for (const vendor of bill.vendors) {
    doc.text(`${vendor.businessName} (${vendor.category})`, 14, y);
    doc.text(formatNaira(vendor.basePrice), 160, y, { align: 'right' });
    y += 6;
  }
  y += 4;

  doc.setLineWidth(0.2);
  doc.line(14, y, 196, y);
  y += 8;

  doc.setFontSize(11);
  doc.text('Subtotal', 14, y);
  doc.text(formatNaira(bill.subtotal), 160, y, { align: 'right' });
  y += 7;
  doc.text('Service charge (10%)', 14, y);
  doc.text(formatNaira(bill.serviceCharge), 160, y, { align: 'right' });
  y += 7;

  doc.setFontSize(13);
  doc.text('Total', 14, y);
  doc.text(formatNaira(bill.totalAmount), 160, y, { align: 'right' });

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
