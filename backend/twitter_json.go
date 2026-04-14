package backend

import (
	"bytes"
	"encoding/json"
)

func extractJSON(output string) string {
	jsonBytes := extractJSONBytes([]byte(output))
	if len(jsonBytes) == 0 {
		return ""
	}
	return string(jsonBytes)
}

func extractJSONBytes(output []byte) []byte {
	trimmed := bytes.TrimSpace(output)
	trimmed = bytes.TrimPrefix(trimmed, []byte("\ufeff"))
	trimmed = bytes.TrimSpace(trimmed)
	if len(trimmed) == 0 {
		return nil
	}

	// Fast path for the common case where stdout already contains only JSON.
	if json.Valid(trimmed) {
		return trimmed
	}

	for i := 0; i < len(output); i++ {
		switch output[i] {
		case '{', '[':
			candidate, ok := decodeJSONValueBytes(output[i:])
			if ok {
				return candidate
			}
		}
	}

	return nil
}

func decodeJSONValue(input string) (string, bool) {
	candidate, ok := decodeJSONValueBytes([]byte(input))
	if !ok {
		return "", false
	}
	return string(candidate), true
}

func decodeJSONValueBytes(input []byte) ([]byte, bool) {
	input = bytes.TrimLeft(input, " \t\r\n")
	if len(input) == 0 {
		return nil, false
	}

	decoder := json.NewDecoder(bytes.NewReader(input))
	decoder.UseNumber()

	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil || len(raw) == 0 {
		return nil, false
	}

	return raw, true
}
