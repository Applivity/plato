using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace Plato.Vs.Native
{
    internal sealed class QuickPickEntry
    {
        public string Label { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string? Detail { get; set; }

        public string Display =>
            string.IsNullOrEmpty(Description) ? Label : Label + "  —  " + Description;
    }

    /// <summary>A small modal list, because Visual Studio has no quick-pick.</summary>
    internal sealed class QuickPickWindow : Window
    {
        private readonly ListBox _list;
        private int? _result;

        private QuickPickWindow(string? placeHolder, IReadOnlyList<QuickPickEntry> items, Color background, Color foreground)
        {
            Title = "Plato";
            Width = 560;
            Height = 380;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            ShowInTaskbar = false;
            Background = new SolidColorBrush(background);
            Foreground = new SolidColorBrush(foreground);

            var grid = new Grid { Margin = new Thickness(14) };
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var prompt = new TextBlock
            {
                Text = string.IsNullOrEmpty(placeHolder) ? "Select an item" : placeHolder,
                Margin = new Thickness(0, 0, 0, 10),
                FontWeight = FontWeights.SemiBold,
            };
            Grid.SetRow(prompt, 0);
            grid.Children.Add(prompt);

            _list = new ListBox
            {
                ItemsSource = items.Select(i => i.Display).ToList(),
                SelectedIndex = items.Count > 0 ? 0 : -1,
                Margin = new Thickness(0, 0, 0, 12),
            };
            _list.MouseDoubleClick += (_, __) => Accept();
            Grid.SetRow(_list, 1);
            grid.Children.Add(_list);

            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            var ok = new Button { Content = "OK", Width = 84, IsDefault = true, Margin = new Thickness(0, 0, 8, 0) };
            ok.Click += (_, __) => Accept();
            var cancel = new Button { Content = "Cancel", Width = 84, IsCancel = true };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);
            Grid.SetRow(buttons, 2);
            grid.Children.Add(buttons);

            Content = grid;
            Loaded += (_, __) => _list.Focus();
        }

        private void Accept()
        {
            if (_list.SelectedIndex < 0)
            {
                return;
            }

            _result = _list.SelectedIndex;
            DialogResult = true;
        }

        public static int? Show(IServiceProvider serviceProvider, string? placeHolder, IReadOnlyList<QuickPickEntry> items)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (items.Count == 0)
            {
                return null;
            }

            var background = ThemeService.BackgroundColor();
            var foreground = ThemeService.ForegroundColor();
            var window = new QuickPickWindow(placeHolder, items, background, foreground);
            return window.ShowDialog() == true ? window._result : null;
        }
    }

    /// <summary>A small modal text or password input.</summary>
    internal sealed class InputBoxWindow : Window
    {
        private readonly TextBox? _text;
        private readonly PasswordBox? _password;
        private string? _result;

        private InputBoxWindow(string? prompt, bool password, string? initial, Color background, Color foreground)
        {
            Title = "Plato";
            Width = 520;
            Height = 210;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            ShowInTaskbar = false;
            Background = new SolidColorBrush(background);
            Foreground = new SolidColorBrush(foreground);

            var grid = new Grid { Margin = new Thickness(14) };
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var label = new TextBlock
            {
                Text = string.IsNullOrEmpty(prompt) ? "Enter a value" : prompt,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10),
            };
            Grid.SetRow(label, 0);
            grid.Children.Add(label);

            FrameworkElement input;
            if (password)
            {
                _password = new PasswordBox { Height = 28, Padding = new Thickness(4) };
                if (!string.IsNullOrEmpty(initial))
                {
                    _password.Password = initial;
                }

                input = _password;
            }
            else
            {
                _text = new TextBox { Height = 28, Padding = new Thickness(4), Text = initial ?? string.Empty };
                input = _text;
            }

            input.Margin = new Thickness(0, 0, 0, 12);
            Grid.SetRow(input, 1);
            grid.Children.Add(input);

            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            var ok = new Button { Content = "OK", Width = 84, IsDefault = true, Margin = new Thickness(0, 0, 8, 0) };
            ok.Click += (_, __) => Accept();
            var cancel = new Button { Content = "Cancel", Width = 84, IsCancel = true };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);
            Grid.SetRow(buttons, 2);
            grid.Children.Add(buttons);

            Content = grid;
            Loaded += (_, __) => input.Focus();
        }

        private void Accept()
        {
            _result = _password != null ? _password.Password : _text?.Text;
            DialogResult = true;
        }

        public static string? Show(IServiceProvider serviceProvider, string? prompt, bool password, string? initial)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var window = new InputBoxWindow(
                prompt,
                password,
                initial,
                ThemeService.BackgroundColor(),
                ThemeService.ForegroundColor());
            return window.ShowDialog() == true ? window._result : null;
        }
    }

    internal static class MessageDialog
    {
        private const int IdOk = 1;
        private const int IdCancel = 2;
        private const int IdYes = 6;
        private const int IdNo = 7;

        public static string? Show(IServiceProvider serviceProvider, string kind, string message, IReadOnlyList<string> actions)
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            var icon = kind == "error"
                ? OLEMSGICON.OLEMSGICON_CRITICAL
                : kind == "warning"
                    ? OLEMSGICON.OLEMSGICON_WARNING
                    : OLEMSGICON.OLEMSGICON_INFO;

            var buttons = actions.Count switch
            {
                0 => OLEMSGBUTTON.OLEMSGBUTTON_OK,
                1 => OLEMSGBUTTON.OLEMSGBUTTON_OKCANCEL,
                2 => OLEMSGBUTTON.OLEMSGBUTTON_YESNO,
                _ => OLEMSGBUTTON.OLEMSGBUTTON_YESNOCANCEL,
            };

            var result = VsShellUtilities.ShowMessageBox(
                serviceProvider,
                message,
                "Plato",
                icon,
                buttons,
                OLEMSGDEFBUTTON.OLEMSGDEFBUTTON_FIRST);

            if (result == IdOk || result == IdYes)
            {
                return actions.Count >= 1 ? actions[0] : null;
            }

            if (result == IdNo)
            {
                return actions.Count >= 2 ? actions[1] : null;
            }

            if (result == IdCancel)
            {
                return actions.Count >= 3 ? actions[2] : null;
            }

            return null;
        }
    }
}
