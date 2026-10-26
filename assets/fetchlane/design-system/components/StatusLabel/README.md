Status of one download as icon + word + optional detail, built by `Fetchlane.statusHTML(download)`.

- Colour is reinforcement only; the icon and words carry the meaning. See the table in the brand book.
- Detail text: failure reason ("Disk full", "Can’t resume", "Connection lost"), retry countdown and attempt ("Retrying in 8 s · 2 of 5"), queue position ("#2 in line"), completion time.
- Retrying is amber and transient; Failed is red and persistent. Never show "Failed" while automatic retries remain.
