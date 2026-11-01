/**
 * Reader-facing text for a failed extraction export.
 *
 * The backend refuses an oversized workbook with `EXPORT_TOO_LARGE`: as the
 * `ApiError.code` on the sync path, and as a `"EXPORT_TOO_LARGE: "` prefix on
 * the async job's `error` string. Either way the user reads words, not a code.
 */
import {t} from "@/lib/copy";

const EXPORT_TOO_LARGE = "EXPORT_TOO_LARGE";

export function extractionExportErrorText(
    code: string | undefined,
    message: string | undefined,
): string {
    if (code === EXPORT_TOO_LARGE || message?.startsWith(`${EXPORT_TOO_LARGE}: `)) {
        return t("extraction", "exportTooLarge");
    }
    return message || t("extraction", "exportFailedToast");
}
