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
                ["--vscode-descriptionForeground"] = Hex(gray),
                ["--vscode-focusBorder"] = Hex(accent),
                ["--vscode-input-background"] = Hex(VSColorTheme.GetThemedColor(EnvironmentColors.ComboBoxBackgroundColorKey)),
                ["--vscode-input-foreground"] = Hex(VSColorTheme.GetThemedColor(EnvironmentColors.ComboBoxTextColorKey)),
                ["--vscode-input-border"] = Hex(VSColorTheme.GetThemedColor(EnvironmentColors.ComboBoxBorderColorKey)),
                ["--vscode-button-background"] = Hex(accent),
                ["--vscode-button-foreground"] = Hex(accentText),
                ["--vscode-button-hoverBackground"] = Hex(
                    Luminance(background) < 0.5
                        ? Blend(accent, System.Drawing.Color.White, 0.12)
                        : Blend(accent, System.Drawing.Color.Black, 0.12)),
                ["--vscode-button-secondaryBackground"] = Hex(Blend(background, foreground, 0.14)),
                ["--vscode-button-secondaryForeground"] = Hex(foreground),
                ["--vscode-editorWidget-background"] = Hex(Blend(background, foreground, 0.04)),
                ["--vscode-textCodeBlock-background"] = Hex(VSColorTheme.GetThemedColor(EnvironmentColors.ToolWindowCodeBlockBackgroundColorKey)),
                ["--vscode-textLink-foreground"] = Hex(accent),
                ["--vscode-list-hoverBackground"] = Hex(VSColorTheme.GetThemedColor(CommonDocumentColors.ListItemBackgroundHoverColorKey)),
                ["--vscode-list-activeSelectionBackground"] = Hex(VSColorTheme.GetThemedColor(CommonDocumentColors.ListItemBackgroundSelectedColorKey)),
                ["--vscode-charts-blue"] = Hex(accent),
                ["--vscode-testing-iconPassed"] = Hex(VSColorTheme.GetThemedColor(EnvironmentColors.VizSurfaceGreenMediumColorKey)),
                ["--vscode-testing-iconFailed"] = Hex(VSColorTheme.GetThemedColor(CommonDocumentColors.StatusBannerErrorTextColorKey)),
                ["--vscode-editorWarning-foreground"] = Hex(VSColorTheme.GetThemedColor(CommonDocumentColors.StatusBannerWarningTextColorKey)),
                ["--vscode-font-family"] = "\"Segoe UI\", system-ui, sans-serif",
                ["--vscode-editor-font-family"] = "\"Cascadia Mono\", Consolas, monospace",
            };

            return colors;
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
