# Track official Pi releases as upstream baselines

Each MetaPi release will bind to an official Pi release and its exact source commit rather than continuously following the upstream main branch. The initial MetaPi baseline is Pi `v0.84.1` at commit `53fa77ccd8a279eb87e92294ef3687b03ff80112`. Upgrading Pi is an explicit MetaPi change: establish the unmodified release baseline and its test result, replay or merge the MetaPi patch set, resolve only necessary conflicts, run upstream and MetaPi regression suites, and record the Pi version and commit in MetaPi release metadata.
