import { SatelliteImage } from "../models/satellite-image";

export function parseFileName(fileName: string): SatelliteImage {
    if (fileName.startsWith('NOAA')) {
        return parseNoaaFileName(fileName);
    } else if (fileName.startsWith('METEOR-M2-3')) {
        return parseMeteorM23FileName(fileName);
    } else {
        throw new Error('Invalid file name format');
    }
}

function parseNoaaFileName(fileName: string): SatelliteImage {
    const [satName, satNumber, idPartOne, idPartTwo] = fileName.split('-');
    return {
        id: `${idPartOne}${idPartTwo}`,
        path: fileName,
        satellite: `${satName} ${satNumber}`
    }
}

function parseMeteorM23FileName(fileName: string): SatelliteImage {
    const [satName, satNumberPartOne, satNumberPartTwo, idPartOne, idPartTwo] = fileName.split('-');
    return {
        id: `${idPartOne}${idPartTwo}`,
        path: fileName,
        satellite: `${satName}-${satNumberPartOne} ${satNumberPartTwo}`
    }
}
