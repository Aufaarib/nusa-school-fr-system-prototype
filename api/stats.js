export default function handler(req, res) {
  // Stats are now primarily fetched from external API on the frontend
  // This is a fallback that returns zeros
  res.json({
    success: true,
    data: {
      totalRegistered: 0,
      todayPresent: 0,
      todayAbsent: 0,
      totalLogs: 0,
    },
  });
}
