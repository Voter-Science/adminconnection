// Sample 'Hello World' Plugin template.
// Demonstrates:
// - typescript
// - using trc npm modules and browserify
// - uses promises.
// - basic scaffolding for error reporting.
// This calls TRC APIs and binds to specific HTML elements from the page.

import * as React from "react";
import * as ReactDOM from "react-dom";

import { SheetContainer } from "trc-react/dist/SheetContainer";
import TRCContext from "trc-react/dist/context/TRCContext";

import * as trcSheet from "trc-sheet/sheet";

import * as plugin from "trc-web/plugin";
import * as tablewriter from "trc-web/tablewriter";
import * as bcl from "trc-analyze/collections";

import { PluginShell } from "trc-react/dist/PluginShell";
import { FullPageLoadingMessage } from "trc-react/dist/common/FullPageLoadingMessage";
import { Panel } from "trc-react/dist/common/Panel";
import { Button } from "trc-react/dist/common/Button";
import { HorizontalList } from "trc-react/dist/common/HorizontalList";

// Installed via:
//   npm install --save-dev @types/jquery
// requires tsconfig: "allowSyntheticDefaultImports" : true
declare var $: JQueryStatic;
declare var _opts: plugin.IPluginOptions;

// Provide easy error handle for reporting errors from promises.  Usage:
//   p.catch(showError);
function showError(error: any) {
  alert(error);
}

function strAgo(time: Date | string) {
  var x = new Date(time.toString());
  var now = new Date();
  return new bcl.TimeRange(x, now).getDurationSecondsPretty() + " ago";
}

// Built from ColumnInfo
interface IColumnData {
  Name: string;
  Kind: string;
  Details: string; // Semantic or Expression?
  Ops: tablewriter.IRenderCell; // delete this column?
}

interface IDisplayRow {
  Version: number;
  TimeAgo: string;
  Comment: string;
}

interface IState {
  loading: boolean;
}

export class App extends React.Component<{}, IState> {
  static contextType = TRCContext;

  private _sheet: trcSheet.SheetClient;

  private _required: string[] = [
    "RecId",
    "FirstName",
    "LastName",
    "Gender",
    "Birthday",
    "Address",
    "City",
    "Lat",
    "Long",
    "Party",
    "ResultOfContact",
  ];

  constructor(props: any, context: any) {
    super(props, context);
    this._sheet = this.context.SheetClient;

    this.checkRequired(this.context._info);

    this.state = {
      loading: false,
    };

    this.onClickRefresh = this.onClickRefresh.bind(this);
    this.updateInfo = this.updateInfo.bind(this);
    this.onShowRebaseLog = this.onShowRebaseLog.bind(this);
    this.applyAllPlugins = this.applyAllPlugins.bind(this);
  }

  private isRequired(name: string): boolean {
    return this._required.indexOf(name) >= 0;
  }

  // Share with EditQuestions plugin
  // Warn if this sheet is missing any required columns
  public checkRequired(info: trcSheet.ISheetInfoResult): void {
    var missing = null;

    for (var i in this._required) {
      var requiredName: string = this._required[i];
      if (info.Columns.find((x) => x.Name == requiredName) == undefined) {
        if (missing == null) {
          missing = requiredName;
        } else {
          missing += ", " + requiredName;
        }
      }
    }

    if (missing != null) {
      showError(
        "Warning! This sheet is missing required columns and may not work on mobile devices: " +
          missing
      );
    }
  }

  private onClickRefresh(): void {
    const admin = new trcSheet.SheetAdminClient(this._sheet);

    this.setState({ loading: true });

    admin
      .postOpRefreshAsync()
      .then(() => {
        this.setState({ loading: false });
        location.reload();
      })
      .catch((e) => {
        this.setState({ loading: false });
        showError(e);
      });
  }

  // Display sheet info on HTML page
  public updateInfo(info: trcSheet.ISheetInfoResult): void {
    var tw = new tablewriter.TableWriter<IColumnData>($("#columnLog"));
    // for (var columnInfo of info.Columns)
    info.Columns.forEach((columnInfo) => {
      var kind = "";
      var details = "";
      var canDelete = false;

      if (columnInfo.Name == "RecId") {
        kind = "(PrimaryKey)";
      } else if (columnInfo.IsReadOnly) {
        kind = "Data";
        if (!!columnInfo.Expression) {
          kind = "Expression";
          details = columnInfo.Expression;
          canDelete = true;
        } else if (!!columnInfo.Semantic) {
          kind = "Semantic";
          details = columnInfo.Semantic;
          canDelete = true;
        }
      } else {
        kind = "(Question)";

        // Questions can start with a semantic, like party id.
        if (!!columnInfo.Semantic) {
          details = columnInfo.Semantic + "] ";
        }

        // details could be possible values
        if (!!columnInfo.PossibleValues) {
          details += columnInfo.PossibleValues.join("; ");
        }
        canDelete = true;
      }

      //var ops : tablewriter.IRenderCell = null;
      var ops: any = null;

      var name = columnInfo.Name;
      if (this.isRequired(columnInfo.Name)) {
        canDelete = false;
        // name += " *";
        ops = "*";
      }

      if (canDelete) {
        ops = new tablewriter.ClickableValue("Delete", () => {
          var ok = confirm(
            "Do you want to delete column '" + columnInfo.Name + "'?"
          );
          if (ok) {
            var admin = new trcSheet.SheetAdminClient(this._sheet);
            admin
              .postOpDeleteQuestionAsync(columnInfo.Name)
              .then(() => {
                location.reload();
              })
              .catch(showError);
          }
        });
      }

      tw.writeRow({
        Name: name,
        Kind: kind,
        Details: details,
        Ops: ops,
      });
    });
  }

  // Demonstrate receiving UI handlers
  public onShowRebaseLog(): void {
    var tw = new tablewriter.TableWriter<IDisplayRow>($("#historyLog"), [
      "Version",
      "TimeAgo",
      "Comment",
    ]);
    var list: trcSheet.IRebaseHistoryItem[] = [];
    this._sheet
      .getRebaseLogAsync()
      .then((iter) =>
        iter.ForEach((item) => {
          // filter out 'Geocode update', too noisy.
          if (item.Comment.indexOf("Geocode update") > 0) {
            return;
          }

          list.push(item);
        })
      )
      .then(() => {
        list.reverse(); // Show most recent first.
        for (var item of list) {
          var ago = strAgo(item.ActualTime);

          var row: IDisplayRow = {
            Version: item.Version,
            Comment: item.Comment,
            TimeAgo: ago,
          };
          tw.writeRow(row);
        }
      })
      .catch(showError);
  }

  // Scan for all <a> with "plugin" class and make into link.
  // <a class="plugin">{PluginId}</a>
  private applyAllPlugins(): void {
    $("a.plugin").each((idx, e) => {
      // Text is the
      var pluginId: string = e.innerText;
      $(e)
        .attr("href", this.getGotoLinkForPlugin(pluginId))
        .attr("target", "_blank");
    });
  }

  // Where <a id="gotoListView" target="_blank">text</a>
  // $("#gotoListView").attr("href", this.getGotoLinkForPlugin("ListView"));
  private getGotoLinkForPlugin(pluginId: string): string {
    if (_opts == undefined) {
      return "/"; // avoid a crash
    }
    return (
      _opts.gotoUrl +
      "/" +
      this._sheet._sheetId +
      "/" +
      pluginId +
      "/index.html"
    );
  }

  componentDidMount() {
    this.updateInfo(this.context._info);
    this.onShowRebaseLog();
    this.applyAllPlugins();
  }

  render() {
    return (
      <PluginShell
        description={
          <p>
            Every TRC sheet is a giant spreadsheet of Rows and Columns. This
            provides admin support for managing this shape and the data
            connections.
          </p>
        }
        title="Admin for Connection"
      >
        {this.state.loading && <FullPageLoadingMessage zIndex={20000} />}

        <Panel>
          <h2>Summary </h2>
          <HorizontalList>
            <div>
              <strong>Name:</strong> {this.context._info.Name}
            </div>
            <div>
              <strong>Version:</strong> {this.context._info.LatestVersion}
            </div>
            <div>
              <strong>Total Rows:</strong> {this.context._info.CountRecords}
            </div>
          </HorizontalList>

          <h2>Refresh</h2>
          <div>
            <p>
              Refresh this sheet to update any rows (if this is connected to an
              external data source) and refresh to the latest version of all the
              data columns ("semantics").
            </p>
            <Button onClick={this.onClickRefresh}>Refresh!</Button>
          </div>

          {this.context._info.SyncStatus && (
            <div id="syncStatus">
              <h2>External Data Connection</h2>
              <p>
                This sheet has an external connection. This means the rows are
                coming from an external source, and the question results are
                being pushed back to that source.
              </p>
              <table>
                <tr>
                  <td>Kind:</td>
                  <td>{this.context._info.SyncStatus.Kind}</td>
                </tr>
                <tr>
                  <td>Description:</td>
                  <td>{this.context._info.SyncStatus.Description}</td>
                </tr>
                <tr>
                  <td>LastSyncVersion:</td>
                  <td>{this.context._info.SyncStatus.LastSyncVersion}</td>
                </tr>
                <tr>
                  <td>LastUpdateTime:</td>
                  <td>{this.context._info.SyncStatus.LastUpdateTime}</td>
                </tr>
                <tr>
                  <td>Last refreshed:</td>
                  <td>{new Date().toLocaleString()}</td>
                </tr>
                <tr id="SyncStatusMsg">
                  <td>Status:</td>
                  <td>
                    {this.context._info.SyncStatus.ErrorMessage &&
                      `Error: ${this.context._info.SyncStatus.ErrorMessage}`}
                    {this.context._info.SyncStatus.LastSyncVersion >=
                    this.context._info.LatestVersion
                      ? "Current!"
                      : `${
                          this.context._info.LatestVersion +
                          1 -
                          this.context._info.SyncStatus.LastSyncVersion
                        } deltas behind current.`}
                  </td>
                </tr>
              </table>
            </div>
          )}

          <h2>Columns</h2>
          <p>
            "Data" columns come from the underlying data source. You can then
            add additional columns that get merged in via matching against the
            PrimaryKey, "RecId":
          </p>
          <ul>
            <li>
              To import new columns of (read-only) data ("Semantic"), use{" "}
              <a className="plugin">DataUploader</a>.
            </li>
            <li>
              To create columns that are expressions of other columns
              ("Expression"), use <a className="plugin">Filter</a>
            </li>
            <li>
              To change questions (adding editable column) data ("Question"),
              use <a className="plugin">EditQuestions</a>
            </li>
          </ul>

          <p>This is the current set of columns:</p>
          <div id="columnLog"></div>
          <p>
            * These columns are required for the mobile canvasser app to work
            properly.
          </p>

          <h2>Rows</h2>
          <p>
            This is a log of previous refreshes to the sheet's base data. These
            refreshes can change the <b>rows</b> and can refresh column data.
          </p>
          <p>
            To create a child sheet that is a subset of the rows for this sheet,
            use <a className="plugin">Filter</a>.
          </p>
          <p>
            To view a history log of the <b>changes</b> to the sheet, use{" "}
            <a className="plugin">Audit</a>.
          </p>
          <div id="historyLog"></div>
        </Panel>
      </PluginShell>
    );
  }
}

ReactDOM.render(
  <SheetContainer fetchContents={false} requireTop={false}>
    <App />
  </SheetContainer>,
  document.getElementById("app")
);
