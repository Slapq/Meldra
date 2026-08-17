# Reuse Pi package management within each Profile

MetaPi will use Pi's existing package installation and resource discovery within each Profile's own agent directory. Pinned Git and npm sources install into that Profile's Pi-managed package roots, while imported local sources are copied into Profile-local storage so later external path changes do not mutate the snapshot. MetaPi adds Profile scoping and source metadata but does not reimplement Pi package installation semantics.
