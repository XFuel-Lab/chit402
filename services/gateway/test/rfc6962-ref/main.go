// Independent RFC 6962 consistency proofs from github.com/transparency-dev/merkle.
// Prints the same lines as services/gateway/scripts/rfc6962-dump.mjs for max=40.
package main

import (
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/transparency-dev/merkle/rfc6962"
	"github.com/transparency-dev/merkle/testonly"
)

func main() {
	h := rfc6962.DefaultHasher
	fmt.Fprintf(os.Stderr, "empty %s\n", hex.EncodeToString(h.EmptyRoot()))
	const max = 40
	tree := testonly.New(h)
	for i := 0; i < max; i++ {
		tree.AppendData([]byte(fmt.Sprintf("leaf-%02d", i)))
	}
	for n := 1; n <= max; n++ {
		for m := 1; m <= n; m++ {
			proof, err := tree.ConsistencyProof(uint64(m), uint64(n))
			if err != nil {
				fmt.Fprintf(os.Stderr, "proof %d %d: %v\n", m, n, err)
				os.Exit(1)
			}
			oldRoot := tree.HashAt(uint64(m))
			newRoot := tree.HashAt(uint64(n))
			parts := make([]string, len(proof))
			for i, node := range proof {
				parts[i] = hex.EncodeToString(node)
			}
			body := "-"
			if len(parts) > 0 {
				body = strings.Join(parts, ",")
			}
			fmt.Printf("%d %d %s %s %s\n", m, n, hex.EncodeToString(oldRoot), hex.EncodeToString(newRoot), body)
		}
	}
}
