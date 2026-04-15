package backend

import "os"

func WriteSmokeReport(payload string) error {
	reportPath := GetSmokeReportPath()
	if reportPath == "" {
		return nil
	}
	return os.WriteFile(reportPath, []byte(payload), 0o600)
}
