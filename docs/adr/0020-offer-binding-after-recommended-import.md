# Offer directory binding after project-recommended imports

After an interactive import initiated from a project's Profile recommendation, MetaPi will ask whether to bind the current directory and descendants to the imported Profile or leave it unbound. The answer updates only the user-local directory binding map. Non-interactive imports require an explicit bind-current or no-bind choice and never infer the binding silently.
