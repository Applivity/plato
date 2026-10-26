using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.VisualStudio.Shell;

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

    /// <summary>
    /// A modal message with the caller's own action labels.
    ///
    /// This is a WPF window, like the two dialogs above, and not
    /// `VsShellUtilities.ShowMessageBox`: in Visual Studio 2026 18.11.12315 the
    /// shell box blocked the UI thread and never created a window when it was
    /// called from a JoinableTask, so a request that needed an answer timed out
    /// with nothing on screen. A WPF dialog also keeps the core's button copy
    /// (for example "New Chat") on the button.
    /// </summary>
    internal sealed class MessageWindow : Window
    {
        private string? _result;

        private MessageWindow(string kind, string message, IReadOnlyList<string> actions, Color background, Color foreground)
        {
            Title = "Plato";
            Width = 460;
            SizeToContent = SizeToContent.Height;
            MinHeight = 150;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            ShowInTaskbar = false;
            Background = new SolidColorBrush(background);
            Foreground = new SolidColorBrush(foreground);

            var grid = new Grid { Margin = new Thickness(16) };
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var glyph = new TextBlock
            {
                Text = kind == "error" ? "\uEA39" : kind == "warning" ? "\uE7BA" : "\uE946",
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 22,
                Margin = new Thickness(0, 0, 14, 0),
                VerticalAlignment = VerticalAlignment.Top,
            };
            Grid.SetRow(glyph, 0);
            Grid.SetColumn(glyph, 0);
            grid.Children.Add(glyph);

            var text = new TextBlock
            {
                Text = message,
                TextWrapping = TextWrapping.Wrap,
            };
            // A long error stays readable without growing the window off screen.
            var scroller = new ScrollViewer
            {
                Content = text,
                MaxHeight = 360,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Margin = new Thickness(0, 0, 0, 18),
            };
            Grid.SetRow(scroller, 0);
            Grid.SetColumn(scroller, 1);
            grid.Children.Add(scroller);

            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            for (var i = 0; i < actions.Count; i++)
            {
                var label = actions[i];
                var button = new Button
                {
                    Content = label,
                    MinWidth = 84,
                    Padding = new Thickness(10, 2, 10, 2),
                    Margin = new Thickness(8, 0, 0, 0),
                    IsDefault = i == 0,
                };
                button.Click += (_, __) => Accept(label);
                buttons.Children.Add(button);
            }

            if (actions.Count == 0)
            {
                var ok = new Button
                {
                    Content = "OK",
                    MinWidth = 84,
                    Padding = new Thickness(10, 2, 10, 2),
                    Margin = new Thickness(8, 0, 0, 0),
                    IsDefault = true,
                };
                ok.Click += (_, __) => Accept(null);
                buttons.Children.Add(ok);
            }
            else
            {
                buttons.Children.Add(new Button
                {
                    Content = "Cancel",
                    MinWidth = 84,
                    Padding = new Thickness(10, 2, 10, 2),
                    Margin = new Thickness(8, 0, 0, 0),
                    IsCancel = true,
                });
            }

            Grid.SetRow(buttons, 1);
            Grid.SetColumn(buttons, 1);
            grid.Children.Add(buttons);

            Content = grid;
            Loaded += (_, __) =>
            {
                var first = buttons.Children.Count > 0 ? buttons.Children[0] as Button : null;
                first?.Focus();
            };
        }

        private void Accept(string? result)
        {
            _result = result;
            DialogResult = true;
        }

        public static string? Show(IServiceProvider serviceProvider, string kind, string message, IReadOnlyList<string> actions)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var window = new MessageWindow(
                kind,
                message,
                actions,
                ThemeService.BackgroundColor(),
                ThemeService.ForegroundColor());
            return window.ShowDialog() == true ? window._result : null;
        }
    }
}
