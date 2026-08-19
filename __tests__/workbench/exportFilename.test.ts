import {
  formatExportTimestampForFilename,
} from "../../artifacts/workbench/src/lib/exportPdf";

describe("formatExportTimestampForFilename", () => {
  it("formats local date and time as YYYYMMDDhhmm", () => {
    expect(
      formatExportTimestampForFilename(new Date(2026, 7, 19, 11, 38)),
    ).toBe("202608191138");
  });

  it("zero-pads month, day, hour and minute", () => {
    expect(
      formatExportTimestampForFilename(new Date(2026, 0, 5, 9, 7)),
    ).toBe("202601050907");
  });
});
