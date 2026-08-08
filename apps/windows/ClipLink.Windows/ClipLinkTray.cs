using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace ClipLink.Windows;

public sealed class ClipLinkTray : Form
{
    private readonly NotifyIcon tray = new();
    private readonly Label status = new();
    private readonly TextBox pairing = new();
    private string lastClipboard = "";
    private readonly string deviceId = Guid.NewGuid().ToString("N")[..8];

    public ClipLinkTray()
    {
        Text = "ClipLink"; Width = 460; Height = 300;
        StartPosition = FormStartPosition.CenterScreen;
        FormClosing += (_, e) => { e.Cancel = true; Hide(); };
        Controls.Add(new Label { Text = "ClipLink", Font = new Font("Segoe UI", 20, FontStyle.Bold), AutoSize = true, Left = 24, Top = 20 });
        status.Text = "Waiting for your Android phone to pair"; status.AutoSize = true; status.Left = 26; status.Top = 66; Controls.Add(status);
        pairing.Multiline = true; pairing.ReadOnly = true; pairing.Font = new Font("Consolas", 10); pairing.Left = 24; pairing.Top = 100; pairing.Width = 390; pairing.Height = 90; pairing.Text = CreatePairingPayload(); Controls.Add(pairing);
        tray.Icon = SystemIcons.Application; tray.Text = "ClipLink"; tray.Visible = true;
        tray.ContextMenuStrip = new ContextMenuStrip();
        tray.ContextMenuStrip.Items.Add("Show pairing", null, (_, _) => ShowWindow());
        tray.ContextMenuStrip.Items.Add("Exit", null, (_, _) => { tray.Visible = false; Application.Exit(); });
        tray.DoubleClick += (_, _) => ShowWindow();
        Shown += (_, _) => Hide();
        System.Windows.Forms.Timer timer = new() { Interval = 500 }; timer.Tick += (_, _) => PollClipboard(); timer.Start();
    }

    private string CreatePairingPayload()
    {
        var ip = Dns.GetHostEntry(Dns.GetHostName()).AddressList.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a))?.ToString() ?? "127.0.0.1";
        return JsonSerializer.Serialize(new { app = "ClipLink", version = 1, deviceId, host = ip, port = 47123, nonce = Guid.NewGuid().ToString("N") });
    }

    private void PollClipboard()
    {
        try { var current = Clipboard.ContainsText() ? Clipboard.GetText() : ""; if (!string.IsNullOrEmpty(current) && current != lastClipboard) { lastClipboard = current; status.Text = $"Clipboard detected · {DateTime.Now:HH:mm:ss}"; } } catch { }
    }

    private void ShowWindow() { Show(); WindowState = FormWindowState.Normal; Activate(); }
}
