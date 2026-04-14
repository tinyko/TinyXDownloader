package backend

import (
	"os"
	"path/filepath"
)

func selectDownloadWorkerCount(tasks []downloadTask) int {
	if len(tasks) == 0 {
		return 0
	}

	videoLikeCount := 0
	for _, task := range tasks {
		if task.item.Type == "video" || task.item.Type == "gif" || task.item.Type == "animated_gif" {
			videoLikeCount++
		}
	}

	numWorkers := MaxConcurrentDownloads
	switch {
	case videoLikeCount == len(tasks):
		numWorkers = MaxConcurrentVideoDownloads
	case videoLikeCount == 0:
		numWorkers = MaxConcurrentImageDownloads
	default:
		numWorkers = MaxConcurrentDownloads
	}
	if numWorkers > len(tasks) {
		numWorkers = len(tasks)
	}

	return numWorkers
}

func buildDownloadTasks(
	items []MediaItem,
	outputDir string,
	username string,
	indexBase int,
	ensuredDirs map[string]struct{},
) []downloadTask {
	tweetMediaCount := make(map[string]map[int64]int)
	tasks := make([]downloadTask, 0, len(items))

	for i, item := range items {
		itemUsername := resolveDownloadUsername(item, username)
		if itemUsername == "" {
			continue
		}

		typeDir := filepath.Join(outputDir, itemUsername, mediaSubfolder(item.Type))
		if _, ok := ensuredDirs[typeDir]; !ok {
			if err := os.MkdirAll(typeDir, 0o755); err != nil {
				continue
			}
			ensuredDirs[typeDir] = struct{}{}
		}

		mediaIndex := nextMediaIndex(tweetMediaCount, itemUsername, item.TweetID)
		filename := buildMediaFilename(item, itemUsername, mediaIndex)
		outputPath := filepath.Join(typeDir, filename)

		tasks = append(tasks, downloadTask{
			item:       item,
			outputPath: outputPath,
			index:      indexBase + i,
		})
	}

	return tasks
}
