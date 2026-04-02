import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const { personName, personId, role, department, timestamp, type } = req.body;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return res.json({ success: false, message: "Email not configured" });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    const isUnknown = type === "unknown";
    const subject = isUnknown
      ? "Unknown Face Detected"
      : `Face Recognized: ${personName}`;

    const html = isUnknown
      ? `<p>An unrecognized face was detected at ${new Date(timestamp).toLocaleString()}</p>`
      : `<p>${personName} (${personId}) recognized at ${new Date(timestamp).toLocaleString()}</p>`;

    await transporter.sendMail({
      from: `"Face Recognition System" <${process.env.EMAIL_USER}>`,
      to: process.env.NOTIFY_EMAIL || process.env.EMAIL_USER,
      subject,
      html,
    });

    res.json({ success: true, message: "Notification sent" });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
}
