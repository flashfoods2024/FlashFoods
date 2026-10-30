# Roboto font assets

Files in this directory are bundled with FlashFoods solely to render
dynamically generated invoice content with `pdf-lib` / `@pdf-lib/fontkit`.

- `Roboto-Regular.ttf`
- `Roboto-Medium.ttf`
- `Roboto-Bold.ttf`

Source: Google Fonts Roboto, Apache License 2.0. Obtained from the
`@expo-google-fonts/roboto` package (v0.4.3) during implementation.
Licence text: `LICENSE.txt` (Apache License 2.0).

SHA-256 checksums (asserted by tests):

```text
15256405ecb0d880678833a582760efad538ab2932318b52c8105b267d159459  Roboto-Regular.ttf
79343dc641a2e8d48a703a4667b71fc8dc6565cc8ce47dfc34fc52c12aadbf38  Roboto-Medium.ttf
4aaf8c5b661a386998c2e70cf2b87e2440f5404e0b8fd81164f0413fb3435ec6  Roboto-Bold.ttf
```

These files are not served over HTTP; the browser never renders invoice text.
Do not replace them with another family or a subset that drops U+20B9 (`₹`).
