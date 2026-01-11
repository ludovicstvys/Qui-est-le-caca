export function queueLabel(queueId?: number | null): string {
  if (queueId == null) return "Unknown";
  switch (queueId) {
    case 420: return "Ranked Solo/Duo";
    case 440: return "Ranked Flex";
    case 450: return "ARAM";
    case 400: return "Normal Draft";
    case 430: return "Normal Blind";
    case 490: return "Quickplay";
    case 700: return "Clash";
    case 1700: return "Arena";
    default: return `Queue ${queueId}`;
  }
}
