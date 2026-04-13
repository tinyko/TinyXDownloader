package backend

import (
	"encoding/json"
	"strings"
)

func extractJSON(output string) string {
	trimmed := strings.TrimSpace(output)
	trimmed = strings.TrimPrefix(trimmed, "\ufeff")
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return ""
	}

	// Fast path for the common case where stdout already contains only JSON.
	if json.Valid([]byte(trimmed)) {
		return trimmed
	}

	for i := 0; i < len(output); i++ {
		switch output[i] {
		case '{', '[':
			candidate, ok := decodeJSONValue(output[i:])
			if ok {
				return candidate
			}
		}
	}

	return ""
}

func decodeJSONValue(input string) (string, bool) {
	input = strings.TrimLeft(input, " \t\r\n")
	if input == "" {
		return "", false
	}

	decoder := json.NewDecoder(strings.NewReader(input))
	decoder.UseNumber()

	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil || len(raw) == 0 {
		return "", false
	}

	return string(raw), true
}
