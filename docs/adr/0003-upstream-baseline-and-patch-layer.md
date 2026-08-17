# Maintain MetaPi as a patch layer over a clean Pi baseline

MetaPi will be built from the complete Pi source and will preserve Pi's default CLI, TUI, runtime behavior, and extension ecosystem. An `upstream` branch will remain byte-for-byte aligned with a selected Pi commit, while publishable MetaPi branches contain small, reviewable feature and integration commits above that baseline; this keeps MetaPi recognizable as Pi, avoids a parallel SDK wrapper or plugin product, and makes upstream synchronization and regression attribution auditable.
