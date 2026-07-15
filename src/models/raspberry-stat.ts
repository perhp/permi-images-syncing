export interface RaspberryStatRecord {
  cpu_temperature_c: number | null;
  cpu_usage_percent: number | null;
  disk_total_bytes: number | null;
  disk_used_bytes: number | null;
  memory_total_bytes: number | null;
  memory_used_bytes: number | null;
  recorded_at: string;
  uptime_ms: number | null;
}

export interface RaspberryStatCollection {
  errors: string[];
  record: RaspberryStatRecord | null;
}
