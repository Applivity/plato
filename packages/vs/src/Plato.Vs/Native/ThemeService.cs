using System;
using System.Collections.Generic;
using System.Drawing;
using Microsoft.VisualStudio.PlatformUI;

namespace Plato.Vs.Native
{
    /// <summary>
    /// Visual Studio has no --vscode-* variables. Read its theme colors and
    /// publish them as CSS custom properties on the page.
    /// </summary>
    internal static class ThemeService
    {
        private static bool _initialized;

        public static event Action? Changed;

        public static void Initialize()
        {
            if (_initialized)
            {
                return;
            }

            _initialized = true;
            VSColorTheme.ThemeChanged += OnThemeChanged;
        }

        private static void OnThemeChanged(ThemeChangedEventArgs e)
        {
            Changed?.Invoke();
        }

        public static System.Windows.Media.Color BackgroundColor()
        {
            var color = VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowBackgroundColorKey);
            return System.Windows.Media.Color.FromArgb(color.A, color.R, color.G, color.B);
        }

        public static System.Windows.Media.Color ForegroundColor()
        {
            var color = VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowTextColorKey);
            return System.Windows.Media.Color.FromArgb(color.A, color.R, color.G, color.B);
        }

        public static System.Drawing.Color WebViewBackground() =>
            VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowBackgroundColorKey);

        public static Dictionary<string, string> Read()
        {
            var background = VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowBackgroundColorKey);
            var foreground = VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowTextColorKey);
            var gray = VSColorTheme.GetThemedColor(EnvironmentColors.SystemGrayTextColorKey);
            // VS 2026's light theme returns a near-white neutral for the whole
            // Accent family (#eeeef2 / #cccedb / #f5f5f5), so a primary button
            // was white on near-white and the switch's track looked off while
            // it was on. The system highlight is the accessible accent pair in
            // both themes (#006cbe with #ffffff text in the light theme).
            var accent = VSColorTheme.GetThemedColor(EnvironmentColors.SystemHighlightColorKey);
            var accentText = VSColorTheme.GetThemedColor(EnvironmentColors.SystemHighlightTextColorKey);

            var colors = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["--vscode-editor-background"] = Hex(background),
                ["--vscode-editor-foreground"] = Hex(foreground),
                ["--vscode-descriptionForeground"] = Hex(Readable(gray, background)),
                ["--vscode-focusBorder"] = Hex(accent),
                ["--vscode-input-background"] = Hex(VSColorTheme.GetThemedColor(EnvironmentColors.ComboBoxBackgroundColorKey)),
                ["--vscode-input-foreground"] = Hex(VSColorTheme.GetThemedColor(EnvironmentColors.ComboBoxTextColorKey)),
                ["--vscode-input-border"] = Hex(VSColorTheme.GetThemedColor(EnvironmentColors.ComboBoxBorderColorKey)),
                ["--vscode-input-placeholderForeground"] = Hex(gray),
                ["--vscode-button-background"] = Hex(accent),
                ["--vscode-button-foreground"] = Hex(accentText),
                ["--vscode-button-hoverBackground"] = Hex(
                    Luminance(background) < 0.5
                        ? Blend(accent, System.Drawing.Color.White, 0.12)
                        : Blend(accent, System.Drawing.Color.Black, 0.12)),
                ["--vscode-button-secondaryBackground"] = Hex(Blend(background, foreground, 0.14)),
                ["--vscode-button-secondaryForeground"] = Hex(foreground),
                ["--vscode-editorWidget-background"] = Hex(Blend(background, foreground, 0.04)),
                // D49fq: Visual Studio's code-block key is not tied to the theme
                // the way its name suggests — the light theme's value all but
                // disappears against the panel. The chip is a tint of the pair
                // we already trust, so it is visible in both themes.
                ["--vscode-textCodeBlock-background"] = Hex(Blend(background, foreground, 0.07)),
                ["--vscode-textLink-foreground"] = Hex(Readable(accent, background)),
                ["--vscode-list-hoverBackground"] = Hex(VSColorTheme.GetThemedColor(CommonDocumentColors.ListItemBackgroundHoverColorKey)),
                ["--vscode-list-activeSelectionBackground"] = Hex(VSColorTheme.GetThemedColor(CommonDocumentColors.ListItemBackgroundSelectedColorKey)),
                ["--vscode-testing-iconPassed"] = Hex(Readable(
                    VSColorTheme.GetThemedColor(EnvironmentColors.VizSurfaceGreenMediumColorKey),
                    background)),
                ["--vscode-testing-iconFailed"] = Hex(Readable(Red, background)),
                ["--vscode-errorForeground"] = Hex(Readable(Red, background)),
                ["--vscode-editorWarning-foreground"] = Hex(Readable(Amber, background)),
                ["--vscode-charts-green"] = Hex(Readable(
                    VSColorTheme.GetThemedColor(EnvironmentColors.VizSurfaceGreenMediumColorKey),
                    background)),
                ["--vscode-charts-purple"] = Hex(Readable(Purple, background)),
                ["--vscode-charts-blue"] = Hex(Readable(accent, background)),
                ["--vscode-font-family"] = "\"Segoe UI\", system-ui, sans-serif",
                ["--vscode-editor-font-family"] = "\"Cascadia Mono\", Consolas, monospace",
            };

            return colors;
        }

        // D49fq: the hues for states that must be readable as TEXT. Visual
        // Studio's own error and warning keys returned the plain foreground in
        // both themes (denied drew white), so the base is fixed and Readable()
        // moves it until it meets the bar.
        private static readonly System.Drawing.Color Red =
            System.Drawing.Color.FromArgb(0xD9, 0x3A, 0x3A);

        private static readonly System.Drawing.Color Amber =
            System.Drawing.Color.FromArgb(0xB8, 0x86, 0x0B);

        private static readonly System.Drawing.Color Purple =
            System.Drawing.Color.FromArgb(0x8E, 0x5A, 0xC8);

        /// <summary>
        /// WCAG contrast ratio between two opaque colours (1:1 to 21:1).
        /// </summary>
        private static double Contrast(System.Drawing.Color a, System.Drawing.Color b)
        {
            var la = Luminance(a);
            var lb = Luminance(b);
            var hi = Math.Max(la, lb);
            var lo = Math.Min(la, lb);
            return (hi + 0.05) / (lo + 0.05);
        }

        /// <summary>
        /// The colour, moved toward white (dark panel) or black (light panel)
        /// until it reaches 4.5:1 against the panel. Small text — the mode
        /// trigger, the done line, the card's marks — is unreadable below that,
        /// and Visual Studio's semantic keys do not guarantee it: measured in
        /// the 2026 dark theme, the auto green was 3.4:1 and the link accent
        /// 3.2:1. Hue is kept; only lightness moves.
        /// </summary>
        private static System.Drawing.Color Readable(
            System.Drawing.Color color,
            System.Drawing.Color background,
            double min = 4.5)
        {
            var target = Luminance(background) < 0.5
                ? System.Drawing.Color.White
                : System.Drawing.Color.Black;
            var c = color;
            for (var i = 0; i < 20 && Contrast(c, background) < min; i++)
            {
                c = Blend(c, target, 0.08);
            }

            return c;
        }

        private static double Luminance(System.Drawing.Color color)
        {
            double Channel(byte value)
            {
                var s = value / 255.0;
                return s <= 0.03928
                    ? s / 12.92
                    : Math.Pow((s + 0.055) / 1.055, 2.4);
            }

            return (0.2126 * Channel(color.R))
                + (0.7152 * Channel(color.G))
                + (0.0722 * Channel(color.B));
        }

        private static System.Drawing.Color Blend(System.Drawing.Color a, System.Drawing.Color b, double amount)
        {
            byte Mix(byte x, byte y) => (byte)Math.Round(x + ((y - x) * amount));
            return System.Drawing.Color.FromArgb(Mix(a.R, b.R), Mix(a.G, b.G), Mix(a.B, b.B));
        }

        private static string Hex(System.Drawing.Color color) =>
            "#" + color.R.ToString("x2") + color.G.ToString("x2") + color.B.ToString("x2");
    }
}
