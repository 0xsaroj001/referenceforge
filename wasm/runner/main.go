// Independent host check for our original comparator. Runs only our artifact.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/tetratelabs/wazero"
)

type vector struct {
	Truth     string `json:"truth"`
	Miner     string `json:"miner"`
	Code      string `json:"code"`
	Tolerance string `json:"tolerance"`
	Expected  string `json:"expected"`
}

func number(text string) int64 {
	n, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		panic(err)
	}
	return n
}

func run() error {
	if len(os.Args) != 4 {
		return fmt.Errorf("usage: wasmrunner artifact.wasm vectors.json report.json")
	}
	bytes, err := os.ReadFile(os.Args[1])
	if err != nil {
		return err
	}
	data, err := os.ReadFile(os.Args[2])
	if err != nil {
		return err
	}
	var vectors []vector
	if err = json.Unmarshal(data, &vectors); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	runtime := wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().WithCloseOnContextDone(true).WithMemoryLimitPages(32))
	defer runtime.Close(ctx)
	compiled, err := runtime.CompileModule(ctx, bytes)
	if err != nil {
		return err
	}
	if len(compiled.ImportedFunctions()) != 0 || len(compiled.ImportedMemories()) != 0 {
		return fmt.Errorf("artifact has imports")
	}
	module, err := runtime.InstantiateModule(ctx, compiled, wazero.NewModuleConfig())
	if err != nil {
		return err
	}
	alloc, score, free := module.ExportedFunction("imw_alloc"), module.ExportedFunction("imw_score_deterministic"), module.ExportedFunction("imw_free")
	if alloc == nil || score == nil || free == nil {
		return fmt.Errorf("missing comparator ABI")
	}
	result, err := alloc.Call(ctx, 16)
	if err != nil || len(result) != 1 || result[0] == 0 {
		return fmt.Errorf("allocator failed: %v", err)
	}
	pointer := uint32(result[0])
	spec := make([]byte, 16)
	started := time.Now()
	for pass := 0; pass < 2; pass++ {
		for i, item := range vectors {
			binary.LittleEndian.PutUint64(spec, uint64(number(item.Code)))
			binary.LittleEndian.PutUint64(spec[8:], uint64(number(item.Tolerance)))
			if !module.Memory().Write(pointer, spec) {
				return fmt.Errorf("spec out of bounds")
			}
			got, err := score.Call(ctx, uint64(number(item.Truth)), uint64(number(item.Miner)), uint64(pointer))
			if err != nil {
				return fmt.Errorf("vector %d: %w", i, err)
			}
			if len(got) != 1 || int64(got[0]) != number(item.Expected) {
				return fmt.Errorf("vector %d mismatch: got %v, want %s", i, got, item.Expected)
			}
		}
	}
	if _, err = free.Call(ctx, uint64(pointer), 16); err != nil {
		return err
	}
	hash := sha256.Sum256(bytes)
	report := map[string]any{"artifact_sha256": hex.EncodeToString(hash[:]), "vectors": len(vectors), "passes": 2, "max_deviation_bps": 0, "imports": 0, "runtime": "wazero v1.12.0", "duration_ms": float64(time.Since(started).Microseconds()) / 1000, "status": "local_cross_runtime_conformance_not_protocol_admission"}
	output, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	output = append(output, '\n')
	if err = os.WriteFile(os.Args[3], output, 0644); err != nil {
		return err
	}
	fmt.Print(string(output))
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
