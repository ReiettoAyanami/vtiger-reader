// Sample tickets for the look only. All names, numbers and texts are invented.
// Step 2 replaces this file's use with the CRM's own data, read every time.
self.VTR_SAMPLE = {
  tickets: [
    {
      id: "2041",
      title: "Printer does not print",
      customer: "Studio Alfa",
      contact: "Contact name",
      opened: "09 Nov 2026, 08:14",
      owner: "Unassigned",
      status: "New",
      clean:
        "Good morning, the printer on the second floor stopped printing after the update.\n\nThe queue shows the jobs, but nothing comes out. Restarting the printer did not help.\n\nThanks, the front desk.",
      raw:
        "From: front desk <desk@studio-alfa.example>\nSubject: printer\n\nGood morning, the printer on the second floor stopped printing after the update.\n\nThe queue shows the jobs, but nothing comes out. Restarting the printer did not help.\n\nThanks, the front desk.\n\n-- \n[signature image set aside]",
      ai: "Print queue stuck after the driver update. Suggested next step: reinstall the driver and clear the spool.",
    },
    {
      id: "2038",
      title: "VPN drops every hour",
      customer: "Studio Beta",
      contact: "Contact name",
      opened: "08 Nov 2026, 17:40",
      owner: "Unassigned",
      status: "In progress",
      clean:
        "The VPN disconnects about every hour and the user has to log in again.\n\nHappens on two laptops, not on the desktop.",
      raw:
        "The VPN disconnects about every hour and the user has to log in again.\n\nHappens on two laptops, not on the desktop.",
      ai: "Drops on laptops only: check the idle timeout on the VPN profile before changing the client.",
    },
    {
      id: "2035",
      title: "Invoice PDF missing lines",
      customer: "Example Srl",
      contact: "Contact name",
      opened: "07 Nov 2026, 11:02",
      owner: "Unassigned",
      status: "Waiting",
      clean:
        "The PDF of the last invoice does not show the two extra lines.\n\nThe total is right, only the detail is missing.",
      raw:
        "The PDF of the last invoice does not show the two extra lines.\n\nThe total is right, only the detail is missing.",
      ai: "Total correct, detail lines missing: likely a template issue, not the data.",
    },
    {
      id: "2029",
      title: "Password reset loop",
      customer: "Example & Co",
      contact: "Contact name",
      opened: "05 Nov 2026, 09:30",
      owner: "Unassigned",
      status: "Waiting",
      clean:
        "The reset link sends the user back to the login page with no error.\n\nThe new password is not accepted at the second try.",
      raw:
        "The reset link sends the user back to the login page with no error.\n\nThe new password is not accepted at the second try.",
      ai: "Looks like an expired reset token: ask the user to request a new link and use it at once.",
    },
  ],
  newTicket: {
    id: "2044",
    title: "Scanner sends no mail",
    customer: "Studio Gamma",
  },
};
