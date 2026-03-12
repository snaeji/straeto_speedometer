# Why This Exists

Straeto's real-time bus GPS data is publicly available. Reykjavík publishes official speed limits for every street. This project connects the two — tracking every bus in real-time and comparing its speed against the posted limit.

## Design Principles

- **Never overestimate speed.** GPS noise systematically inflates distance. The pipeline is tuned conservative — if it flags a violation, it's real.
- **Immediately understandable.** The audience is the general public. The map should speak for itself.
- **Data, not drama.** No editorializing. Here's what's happening — draw your own conclusions.
- **Show your work.** Data sources, methods, and limitations are documented openly.
