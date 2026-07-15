import {
  getCPUTemperatureAsync,
  getCPUUsageAsync,
  getDiskUsageAsync,
  getMemoryUsageAsync,
  getUptimeAsync,
} from "raspberry-stats";
import { AppConfig } from "./config";
import {
  RaspberryStatCollection,
  RaspberryStatRecord,
} from "./models/raspberry-stat";

const KIBIBYTE = 1_024;

async function safelyCollect<T>(
  label: string,
  collect: () => Promise<{ data: T | null; error: string | null }>
) {
  try {
    return await collect();
  } catch (error) {
    return {
      data: null,
      error: `${label}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export class RaspberryStatsSource {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  async collect(): Promise<RaspberryStatCollection> {
    const [temperature, cpu, memory, disks, uptime] = await Promise.all([
      safelyCollect("CPU temperature", getCPUTemperatureAsync),
      safelyCollect("CPU usage", getCPUUsageAsync),
      safelyCollect("Memory", getMemoryUsageAsync),
      safelyCollect("Disk", getDiskUsageAsync),
      safelyCollect("Uptime", getUptimeAsync),
    ]);
    const errors: string[] = [];

    if (temperature.error) errors.push(`CPU temperature: ${temperature.error}`);
    if (cpu.error) errors.push(`CPU usage: ${cpu.error}`);
    if (memory.error) errors.push(`Memory: ${memory.error}`);
    if (disks.error) errors.push(`Disk: ${disks.error}`);
    if (uptime.error) errors.push(`Uptime: ${uptime.error}`);

    const rootDisk = disks.data?.find(
      (disk) => disk.mountedOn === this.config.statsDiskMount
    );
    if (disks.data && !rootDisk) {
      errors.push(`Disk: mount ${this.config.statsDiskMount} was not found`);
    }

    const memoryIsValid =
      validNumber(memory.data?.total) &&
      validNumber(memory.data?.used) &&
      memory.data!.used <= memory.data!.total;
    const diskIsValid =
      validNumber(rootDisk?.oneKBlocks) &&
      validNumber(rootDisk?.used) &&
      rootDisk!.used <= rootDisk!.oneKBlocks;

    const record: RaspberryStatRecord = {
      cpu_temperature_c: validNumber(temperature.data)
        ? temperature.data
        : null,
      cpu_usage_percent:
        validNumber(cpu.data) && cpu.data! <= 100 ? cpu.data : null,
      disk_total_bytes: diskIsValid
        ? rootDisk!.oneKBlocks * KIBIBYTE
        : null,
      disk_used_bytes: diskIsValid ? rootDisk!.used * KIBIBYTE : null,
      memory_total_bytes: memoryIsValid
        ? memory.data!.total * KIBIBYTE
        : null,
      memory_used_bytes: memoryIsValid
        ? memory.data!.used * KIBIBYTE
        : null,
      recorded_at: new Date().toISOString(),
      uptime_ms: validNumber(uptime.data) ? uptime.data : null,
    };
    const values = Object.entries(record).filter(
      ([key]) => key !== "recorded_at"
    );

    return {
      errors,
      record: values.some(([, value]) => value !== null) ? record : null,
    };
  }
}
